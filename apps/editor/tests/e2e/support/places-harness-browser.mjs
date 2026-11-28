// Browser-side harness for places. The test replaces __APP_BASE__ with the served editor root, so this module imports
// the same component modules as app.js and mounts only places, with buildings as the context a place belongs to, on a
// small map and a small DOM.
import {hitTest} from '__APP_BASE__map-core/index.js';
import {hideToast, showToast} from '__APP_BASE__map-tools/toast.js';
import {createActiveLayerCommands} from '__APP_BASE__editing/active-layer-commands.js';
import {buildChangeset} from '__APP_BASE__editing/changeset.js';
import {EditSession} from '__APP_BASE__editing/edit-session.js';
import {InspectorEditing} from '__APP_BASE__inspector/inspector-editing.js';
import {createHandleLayer} from '__APP_BASE__map-tools/handle-layer.js';
import {isMagnetOn} from '__APP_BASE__map-tools/magnet-switch.js';
import {showModeBar, hideModeBar} from '__APP_BASE__map-tools/mode-bar.js';
import {createJointLayer} from '__APP_BASE__layers/shared/joint-layer.js';
import {availableLayers} from '__APP_BASE__layers/shared/editor-layers.js';
import {
  behaviorOf,
  createBehaviorContext,
  drawChoicesOf,
  newFeatureFields,
  registerBehaviors
} from '__APP_BASE__layers/shared/layer-behaviors.js';
import {validateLayerRules} from '__APP_BASE__layers/shared/layer-rules.js';
import {placeBehaviors} from '__APP_BASE__layers/places/layer-places.js';
import {isPickableEntry, roadsPickableEntries} from '__APP_BASE__layers/roads/roads-host.js';
import {createSourceOverlay, overlayCollection} from '__APP_BASE__source-data/source-overlay.js';

const element = id => document.getElementById(id);
const setStatus = message => {
  element('status').textContent = message;
};

// A local style gives the production overlays symbol layers to sit under without loading the basemap archive. The map is
// a bare engine instance: map-core's createMap installs its own style and assets, which this harness avoids.
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

function createHarnessState({sourceEntries, rulesConfig, map, draft}) {
  const sources = new Map(sourceEntries.map(([filename, source]) => [filename, source]));
  const rules = validateLayerRules(rulesConfig, [...sources.keys()]);
  const session = new EditSession(sources);
  if (draft) session.restoreDraft(draft);
  const activeLayer = availableLayers([...sources.keys()]).find(layer => layer.id === 'places');
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
    entries: [],
    pendingPoint: null,
    clickCount: 0
  };
  // Buildings are context here: a place reads them through entriesOf, but only places are drawn and picked.
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
    shownLevel: () => null,
    select: entry => selectObject(state, entry),
    startNew: choice => startNewFeature(state, choice),
    pickPoint: (prompt, onPicked) => pickPoint(state, prompt, onPicked),
    showPath: (coordinates, colour) => state.overlay.setPath(coordinates, colour)
  });
}

function selectObject(state, entry) {
  if (state.editing.hasUnappliedEdit) {
    setStatus('Apply or Cancel the current edit first.');
    return false;
  }
  const feature = entry.feature;
  if (!feature) return false;
  state.editing.close();
  const behavior = behaviorOf(entry.filename, state.activeLayer.id);
  element('selection-kind').textContent = behavior.kind(feature);
  element('selection-title').textContent = behavior.title(feature, state.context());
  state.overlay.setSelection(feature.geometry ? feature : null);
  state.editing.openExisting({...entry, feature});
  return true;
}

function startNewFeature(state, choice) {
  state.editing.close();
  const localId = `local:${crypto.randomUUID()}`;
  const fields = newFeatureFields(choice.filename, localId, state.rules);
  element('selection-title').textContent = 'New';
  state.editing.openNew(choice.filename, localId, choice.shape, {
    ...fields,
    properties: {...fields.properties, ...choice.properties}
  });
}

// A place put down without geometry asks for the point under the tap, as it does in the app.
function pickPoint(state, prompt, onPicked) {
  hideInspector();
  state.pendingPoint = {onPicked};
  showModeBar({
    title: prompt,
    hint: 'Tap the place on the map',
    buttons: [{id: 'mode-cancel', label: 'Cancel', run: () => finishPoint(state, null)}]
  });
}

function finishPoint(state, coordinate) {
  const {onPicked} = state.pendingPoint;
  state.pendingPoint = null;
  hideModeBar();
  showInspector();
  onPicked(coordinate);
}

function showInspector() {
  element('editor').hidden = false;
}

function hideInspector() {
  element('editor').hidden = true;
}

function updateChangeCount(state) {
  const count = state.session.changeCount() + state.session.fieldItems().length;
  element('change-count').textContent = String(count);
  element('change-count').hidden = count === 0;
}

function showStatus(state) {
  const count = state.entries.filter(entry => isPickableEntry(entry, state.activeLayer)).length;
  setStatus(`Places · ${count} objects · editable`);
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
    showMarks: () => {},
    onRecorded: message => {
      refreshOverlay(state);
      if (message) showToast(message, {action: () => {
        state.commands.undo();
        refreshOverlay(state);
        updateChangeCount(state);
      }});
      else hideToast();
    },
    onClosed: () => refreshOverlay(state),
    onMarkedForDeletion: () => {},
    onNoteWanted: () => {},
    isResolving: () => false,
    showInspector,
    hideInspector,
    releaseInspectorFocus: () => false,
    focusStatus: () => {},
    onEditStateChanged: () => updateChangeCount(state)
  });
}

function refreshOverlay(state) {
  state.entries = state.activeLayer.files.flatMap(state.entriesOf);
  const changedFeatures = new Set(
    state.session.changedFiles().flatMap(filename => state.session.changes(filename).map(({after}) => after).filter(Boolean))
  );
  const collection = overlayCollection(
    state.entries,
    entry => (changedFeatures.has(entry.feature) ? 'applied' : 'editable'),
    () => ({})
  );
  state.overlay.setData(collection);
  state.overlay.setApplied([]);
  state.jointLayer.show([]);
  showStatus(state);
}

function selectableLayerIds(state) {
  return [...state.overlay.layerIds, ...state.overlay.inspectionLayerIds];
}

function selectFeatureAtClick(state, event) {
  try {
    if (state.editing.hasGeometryTool && !state.pendingPoint) {
      state.editing.tap(event);
      return;
    }
    if (state.pendingPoint) {
      finishPoint(state, event.lngLat.toArray());
      return;
    }
    if (state.editing.hasUnappliedEdit) {
      setStatus('Apply or Cancel the current edit first.');
      return;
    }
    const candidates = roadsPickableEntries({
      hits: hitTest(state.map, event.point, selectableLayerIds(state)),
      entries: state.entries,
      layer: state.activeLayer,
      shownLevel: null
    });
    if (candidates.length > 0) selectObject(state, candidates[0]);
    else state.editing.close();
  } finally {
    state.clickCount += 1;
  }
}

function installMapListeners(state) {
  state.map.on('click', event => selectFeatureAtClick(state, event));
  state.map.on('dblclick', event => {
    if (state.editing.finishWithDoubleClick()) event.preventDefault();
  });
}

// Mounts the places layer as the app registers it: behaviors, a session, the inspector and the map overlays. No app.js,
// side panel, toolbar or source table: only the elements these modules actually read.
export async function mountPlacesHarness({sourceEntries, rulesConfig, appBase, draft}) {
  const map = await createHarnessMap(appBase);
  const state = createHarnessState({sourceEntries, rulesConfig, map, draft});
  window.editorDebug = {map};
  state.editing = createEditing(state);
  state.editing.registerActions();
  element('close-inspector').onclick = () => state.editing.close();
  element('draw-choices').replaceChildren(
    ...drawChoicesOf(state.activeLayer, state.rules).map(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      button.onclick = () => startNewFeature(state, choice);
      return button;
    })
  );
  installMapListeners(state);
  registerBehaviors(placeBehaviors);
  refreshOverlay(state);
  window.placesHarness = {
    clickCount: () => state.clickCount,
    exportChangeset: envelope =>
      buildChangeset(state.session, state.sources, envelope ?? {author: 'Browser Test', reason: 'Browser test'}, state.rules),
    exportDraft: () => state.session.exportDraft()
  };
}
