// Browser-side harness for roads and junctions. The test replaces __APP_BASE__ with the served editor root, so this
// module imports the same component modules as app.js and mounts only those, on a small map and a small DOM.
import {hitTest} from '__APP_BASE__map-core/index.js';
import {hideToast, showToast} from '__APP_BASE__map-tools/toast.js';
import {createActiveLayerCommands} from '__APP_BASE__editing/active-layer-commands.js';
import {buildChangeset} from '__APP_BASE__editing/changeset.js';
import {EditSession} from '__APP_BASE__editing/edit-session.js';
import {InspectorEditing} from '__APP_BASE__inspector/inspector-editing.js';
import {createHandleLayer} from '__APP_BASE__map-tools/handle-layer.js';
import {isMagnetOn} from '__APP_BASE__map-tools/magnet-switch.js';
import {createJointLayer, jointMinZoom} from '__APP_BASE__layers/shared/joint-layer.js';
import {availableLayers} from '__APP_BASE__layers/shared/editor-layers.js';
import {behaviorOf, createBehaviorContext, registerBehaviors} from '__APP_BASE__layers/shared/layer-behaviors.js';
import {featureForEntry, junctionBehaviors, junctionFile, junctionRule} from '__APP_BASE__layers/roads/layer-junctions.js';
import {roadBehaviors} from '__APP_BASE__layers/roads/layer-roads.js';
import {
  entryOnShownLevel,
  jointOnShownLevel,
  layerJoints,
  levelFacts
} from '__APP_BASE__layers/shared/layer-joints.js';
import {validateLayerRules} from '__APP_BASE__layers/shared/layer-rules.js';
import {derivedFacts} from '__APP_BASE__source-data/derived-facts.js';
import {createSourceOverlay, overlayCollection, sourceEntriesForHits} from '__APP_BASE__source-data/source-overlay.js';
import {showLevelPicker} from '__APP_BASE__layers/roads/level-picker.js';

const element = id => document.getElementById(id);
const setStatus = message => {
  element('status').textContent = message;
};

// A local style gives the production overlays a symbol layer to sit under without loading the basemap archive.
// The map is a bare engine instance: map-core's createMap installs its own style and assets, which this harness avoids.
async function createHarnessMap(appBase) {
  const assetBaseURL = new URL(appBase, location.href).href;
  const emptyCollection = {type: 'FeatureCollection', features: []};
  const map = new window.maplibregl.Map({
    container: element('harness-map'),
    style: {
      version: 8,
      glyphs: `${new URL('fonts/', assetBaseURL).href}{fontstack}/{range}.pbf`,
      sources: {'harness-symbols': {type: 'geojson', data: emptyCollection}},
      layers: [
        {id: 'harness-background', type: 'background', paint: {'background-color': '#f2efe9'}},
        {
          id: 'harness-symbols',
          type: 'symbol',
          source: 'harness-symbols',
          minzoom: 24,
          layout: {'text-field': '', 'text-font': ['Open Sans Semibold']}
        }
      ]
    },
    center: [19.26, 42.44],
    zoom: 19,
    maxZoom: 23,
    fadeDuration: 0,
    attributionControl: false,
    renderWorldCopies: false
  });
  await new Promise((resolve, reject) => {
    map.once('load', resolve);
    map.once('error', reject);
  });
  return map;
}

function createHarnessState({sourceEntries, rulesConfig, map}) {
  const sources = new Map(sourceEntries.map(([filename, source]) => [filename, source]));
  let rules = validateLayerRules(rulesConfig, [...sources.keys()]);
  rules = {...rules, layers: {...rules.layers, [junctionFile]: junctionRule}};
  const session = new EditSession(sources);
  const activeLayer = availableLayers([...sources.keys()]).find(layer => layer.id === 'roads');
  const state = {
    map,
    sources,
    rules,
    session,
    activeLayer,
    levels: new Set([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]),
    commands: createActiveLayerCommands(session, () => activeLayer),
    overlay: createSourceOverlay(map),
    jointLayer: createJointLayer(map),
    handles: createHandleLayer(map),
    activeEntries: [],
    shownLevel: null
  };
  state.entriesOf = filename => (sources.has(filename) ? session.workingEntries(filename) : []);
  state.context = () => behaviorContextOf(state);
  return state;
}

function behaviorContextOf(state) {
  return createBehaviorContext({
    session: state.session,
    rules: state.rules,
    levels: state.levels,
    map: state.map,
    layer: state.activeLayer,
    isPhone: () => false,
    isMagnetOn,
    entriesOf: state.entriesOf,
    shownLevel: () => state.shownLevel,
    select: entry => selectObject(state, entry),
    startNew: ({filename, shape, properties, geometry}) => {
      const localId = `local:${crypto.randomUUID()}`;
      state.editing.openNew(filename, localId, shape, {properties, geometry});
    },
    pick: () => Promise.resolve(null),
    pickPoint: () => Promise.resolve(null),
    showPath: (coordinates, colour) => state.overlay.setPath(coordinates, colour)
  });
}

function selectObject(state, entry) {
  if (state.editing.hasUnappliedEdit) {
    setStatus('Apply or Cancel the current edit first.');
    return false;
  }
  const feature = featureForEntry(entry, state.session);
  if (!feature) return false;
  state.editing.close();
  const behavior = behaviorOf(entry.filename, state.activeLayer.id);
  element('selection-kind').textContent = behavior.kind(feature);
  element('selection-title').textContent = behavior.title(feature, state.context());
  state.overlay.setSelection(feature.geometry ? feature : null);
  state.editing.openExisting({...entry, feature});
  return true;
}

function updateChangeCount(state) {
  const count = state.session.changeCount();
  element('change-count').textContent = String(count);
  element('change-count').hidden = count === 0;
}

function showStatus(state) {
  setStatus(`Roads · ${state.activeEntries.length} objects · editable`);
}


function createEditing(state) {
  return new InspectorEditing({
    commands: state.commands,
    session: state.session,
    rules: state.rules,
    levels: state.levels,
    overlay: state.overlay,
    map: state.map,
    handles: state.handles,
    isPhone: () => false,
    behaviorContext: state.context,
    showMarks: marks => state.jointLayer.showMarks(marks),
    onRecorded: message => {
      refreshOverlay(state);
      if (message) showToast(message, {action: () => {
        state.commands.undo();
        refreshOverlay(state);
      }});
      else hideToast();
    },
    onClosed: () => refreshOverlay(state),
    onMarkedForDeletion: () => {},
    onNoteWanted: () => {},
    isResolving: () => false,
    showInspector: () => {
      element('editor').hidden = false;
    },
    hideInspector: () => {
      element('editor').hidden = true;
    },
    releaseInspectorFocus: () => false,
    focusStatus: () => {},
    onEditStateChanged: () => updateChangeCount(state)
  });
}

function viewBounds(state) {
  const bounds = state.map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
}

function renderJoints(state) {
  const {map, jointLayer} = state;
  if (map.getZoom() < jointMinZoom) {
    jointLayer.show([]);
    return;
  }
  const joints = layerJoints.roads.joints(viewBounds(state), state.context());
  jointLayer.show(joints.filter(joint => jointOnShownLevel(joint, state.shownLevel)));
}

function renderLevels(state) {
  state.overlay.setShownLevel(state.shownLevel);
  const levelsInView = layerJoints.roads.levels(viewBounds(state), state.context());
  const levels = new Set(levelsInView);
  if (state.shownLevel !== null) levels.add(state.shownLevel);
  showLevelPicker([...levels], state.shownLevel, level => {
    state.shownLevel = level;
    refreshOverlay(state);
  });
}

function refreshOverlay(state) {
  const {activeLayer, overlay, session} = state;
  state.activeEntries = [...activeLayer.files, ...activeLayer.contextFiles].flatMap(state.entriesOf);
  const changedFeatures = new Set(
    session.changedFiles().flatMap(filename => session.changes(filename).map(({after}) => after).filter(Boolean))
  );
  const collection = overlayCollection(
    state.activeEntries,
    entry => (changedFeatures.has(entry.feature) ? 'applied' : 'editable'),
    entry => ({...levelFacts(entry), ...derivedFacts(entry, state.entriesOf)})
  );
  overlay.setData(collection);
  overlay.setApplied([]);
  renderLevels(state);
  renderJoints(state);
  showStatus(state);
}

function selectFeatureAtClick(state, event) {
  if (state.editing.hasGeometryTool) {
    state.editing.tap(event);
    return;
  }
  if (state.editing.hasUnappliedEdit) {
    setStatus('Apply or Cancel the current edit first.');
    return;
  }
  const joint = state.jointLayer.jointAt(event.point);
  const jointEntry = joint && layerJoints.roads.entry?.(joint, state.context());
  if (jointEntry) {
    selectObject(state, jointEntry);
    return;
  }
  const hits = hitTest(state.map, event.point, [...state.overlay.layerIds, ...state.overlay.inspectionLayerIds]);
  const candidates = sourceEntriesForHits(hits, state.activeEntries).filter(
    ({filename, feature}) =>
      state.activeLayer.files.includes(filename) &&
      Boolean(feature.geometry) &&
      entryOnShownLevel({filename, feature}, state.shownLevel)
  );
  if (candidates.length === 0) state.editing.close();
  else selectObject(state, candidates[0]);
}

function installMapListeners(state) {
  state.map.on('click', event => selectFeatureAtClick(state, event));
  state.map.on('dblclick', event => {
    if (state.editing.finishWithDoubleClick()) event.preventDefault();
  });
  state.map.on('moveend', () => renderLevels(state));
  state.map.on('idle', () => renderJoints(state));
}

// Mounts the roads layer as the app registers it: two behaviors, a session, the inspector and the map overlays. No
// app.js, side panel, toolbar or source table: only the elements these modules actually read.
export async function mountRoadsHarness({sourceEntries, rulesConfig, appBase}) {
  const map = await createHarnessMap(appBase);
  const state = createHarnessState({sourceEntries, rulesConfig, map});
  window.editorDebug = {map};
  state.editing = createEditing(state);
  state.editing.registerActions();
  element('close-inspector').onclick = () => {
    state.editing.close();
  };
  installMapListeners(state);
  registerBehaviors(roadBehaviors);
  registerBehaviors(junctionBehaviors);
  refreshOverlay(state);
  window.roadsHarness = {
    exportChangeset: envelope =>
      buildChangeset(state.session, state.sources, envelope ?? {author: 'Browser Test', reason: 'Browser test'}, state.rules),
    get shownLevel() {
      return state.shownLevel;
    },
    session: state.session,
    state: {
      get activeEntries() {
        return state.activeEntries;
      }
    }
  };
  return {mounted: true, layers: state.activeLayer.files};
}
