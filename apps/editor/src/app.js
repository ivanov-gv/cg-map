import {
  archiveFilenamePattern,
  createGeoJSONOverlay,
  createMap,
  hitTest,
  installPlaces,
  parseVisibilityConfig,
  registerArchiveProtocol,
  satelliteBounds,
  setSatelliteVisible,
  whenMapReady
} from '@ivanov-gv/map-core';
import {createActiveFileCommands} from './active-file-commands.js';
import {
  clearSetAsideDrafts,
  openSavedDraft,
  readSavedDraftText,
  readSetAsideDrafts,
  removeSavedDraft,
  saveDraft
} from './draft-store.js';
import {downloadJSON, elementById} from './dom.js';
import {EditSession} from './edit-session.js';
import {createHandleLayer} from './handle-layer.js';
import {InspectorEditing} from './inspector-editing.js';
import {startOfflineCopy} from './offline-install.js';
import {featureCapabilities, layerLockReason, validateLayerRules} from './layer-rules.js';
import {ReviewPanel} from './review-panel.js';
import {loadSourceBundle} from './source-bundle.js';
import {overlayCollection, sourceFeatureForHit} from './source-overlay.js';

const layerNames = {
  'places.geojson': 'POIs',
  'buildings.geojson': 'Buildings',
  'building-labels.geojson': 'Building labels',
  'roads.geojson': 'Roads & paths',
  'land.geojson': 'Land',
  'water.geojson': 'Water',
  'context-countries.geojson': 'Country outlines',
  'transport-stops.geojson': 'Bus stops'
};
const basemapLayers = {
  'buildings.geojson': ['buildings'],
  'building-labels.geojson': ['building-numbers'],
  'land.geojson': ['land'],
  'water.geojson': ['water', 'rivers'],
  'roads.geojson': [
    'road-casing',
    'minor-casing',
    'minor-roads',
    'pedestrian-streets',
    'footways',
    'paths',
    'cycleways',
    'steps',
    'major-roads',
    'road-labels'
  ]
};
const applyOrCancelMessage = 'Apply or Cancel the current edit first.';
const addFeatureLabels = {'places.geojson': 'Add POI', 'roads.geojson': 'Draw road'};
// Matches the stylesheet breakpoint where the inspector moves below the map.
const stackedLayoutQuery = '(max-width: 720px)';
const hiddenLayerFilter = ['==', ['literal', 1], 0];
let map;
let sources;
let overlay;
let activeFile = null;
let hiddenLayers = new Map();
let isSatelliteVisible = false;
let isModeLoading = false;
let rules;
let session;
let editing;
let review;
let commands;
let isDraftSavingBlocked = false;
let wasEditOpen = false;
let isDraftProblemShown = false;
let isDraftSaveFailing = false;

// Errors stay on screen even when part of the map rendered successfully.
function showError(error) {
  isDraftProblemShown = false;
  elementById('error').textContent = error.message;
  elementById('error').hidden = false;
  elementById('status').textContent = 'Source viewer needs attention';
}

// A draft problem can clear itself once a save succeeds. Any other error stays on screen.
function showDraftProblem(message) {
  showError(new Error(message));
  isDraftProblemShown = true;
}

function clearDraftProblem() {
  if (!isDraftProblemShown) return;
  isDraftProblemShown = false;
  elementById('error').hidden = true;
  elementById('status').textContent = activeFile ? modeStatus() : 'Browse · all source files locked';
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// The status for the active mode with nothing selected and its source fully rendered.
function modeStatus() {
  if (!activeFile) return 'Browse · all source files locked';
  const featureCount = session.workingEntries(activeFile).length;
  const access = layerLockReason(rules.layers[activeFile]) ? 'read-only' : 'editable';
  return `${activeFile} · ${featureCount} source features · ${access}`;
}

// On phones the inspector sits below the map, so the status over the map has to point at it.
function selectionStatus(index) {
  const isInspectorBelowMap = matchMedia(stackedLayoutQuery).matches;
  const inspectorHint = isInspectorBelowMap ? ' · details below the map' : '';
  return `${activeFile} · feature ${index} selected${inspectorHint}`;
}

function appendProperty(name, value) {
  const term = document.createElement('dt');
  const definition = document.createElement('dd');
  term.textContent = name;
  definition.textContent = typeof value === 'object' ? JSON.stringify(value) : String(value);
  elementById('properties').append(term, definition);
}

function showLockReason(reason) {
  elementById('lock-reason').textContent = reason ?? '';
  elementById('lock-reason').hidden = !reason;
}

// Objects are selected from full source geometry, never clipped tile coordinates. Upstream IDs are
// shown here because overlay features use the array index as their ID instead.
function showFeature(feature, index) {
  editing.close();
  const properties = feature.properties;
  const hash = sources.get(activeFile).metadata.sha256;
  elementById('selection-title').textContent =
    properties.name || properties['addr:housenumber'] || feature.geometry.type;
  elementById('selection-source').textContent = `${activeFile} · feature ${index}`;
  elementById('identity').textContent = `Pinned source SHA-256: ${hash}. Feature indices are revision-bound.`;
  elementById('source-id').textContent = feature.id === undefined ? '' : `Source feature ID: ${feature.id}`;
  elementById('properties').replaceChildren();
  for (const [name, value] of Object.entries(properties)) appendProperty(name, value);
  elementById('status').textContent = selectionStatus(index);
  overlay.setSelection(feature);
  const {canModify, lockReason} = featureCapabilities(feature, rules.layers[activeFile]);
  showLockReason(lockReason);
  if (canModify) editing.openExisting(index, feature);
}

// Returns the inspector to its empty state for the active mode.
function clearSelection() {
  editing.close();
  showLockReason(activeFile ? layerLockReason(rules.layers[activeFile]) : null);
  elementById('selection-title').textContent = 'Select an object';
  elementById('selection-source').textContent = activeFile
    ? `Inspecting ${activeFile}`
    : 'Choose a file mode, then select its geometry on the map.';
  elementById('properties').replaceChildren();
  elementById('identity').textContent = '';
  elementById('source-id').textContent = '';
  elementById('status').textContent = modeStatus();
}

// Hide the corresponding published geometry while the complete source is visible.
// Filters preserve the core's independent house-number scale/visibility behavior.
function maskPublishedLayer(filename) {
  for (const [layerId, filter] of hiddenLayers) map.setFilter(layerId, filter);
  hiddenLayers = new Map();
  let layerIds = basemapLayers[filename] ?? [];
  if (filename === 'places.geojson') {
    layerIds = map
      .getStyle()
      .layers.filter(layer => layer.source === 'places')
      .map(layer => layer.id);
  }
  for (const layerId of layerIds) {
    hiddenLayers.set(layerId, map.getFilter(layerId) ?? null);
    map.setFilter(layerId, hiddenLayerFilter);
  }
}

// The overlay always shows the working state, so an applied move leaves no feature at its old position.
function refreshOverlay() {
  const features = activeFile ? session.workingEntries(activeFile).map(({feature}) => feature) : [];
  overlay.setData(overlayCollection(activeFile, features));
}

function showLoadingStatus() {
  isModeLoading = activeFile !== null;
  if (isModeLoading) elementById('status').textContent = `Loading ${activeFile}…`;
}

function hasOnlyInMemoryChanges() {
  const isDraftUnsaved = isDraftSaveFailing || isDraftSavingBlocked;
  return isDraftUnsaved && session.changedFiles().length > 0;
}

// History or a new feature would replace an open edit, so they wait, as export, import and discarding do.
function renderCommandAvailability() {
  const isIdleInMode = activeFile && !editing.hasUnappliedEdit;
  elementById('undo').disabled = !isIdleInMode || !session.canUndo(activeFile);
  elementById('redo').disabled = !isIdleInMode || !session.canRedo(activeFile);
  elementById('add-feature').disabled = !isIdleInMode;
  // Updating reloads the page, which would lose an edit not applied yet, or applied edits that could not be saved.
  elementById('update-app').disabled = editing.hasUnappliedEdit || hasOnlyInMemoryChanges();
  elementById('update-hint').hidden = session.changedFiles().length === 0;
  review.render();
}

function renderAddFeature() {
  const addLabel = addFeatureLabels[activeFile];
  elementById('add-feature').hidden = !addLabel;
  elementById('add-feature').textContent = addLabel ?? '';
}

function renderFeatureCounts() {
  for (const row of document.querySelectorAll('[data-source]')) {
    row.querySelector('td').textContent = session.workingEntries(row.dataset.source).length;
  }
}

// Saving can fail when storage is full or blocked. Say so, because the editor believes the work is safe otherwise.
function persistDraft() {
  if (isDraftSavingBlocked) return;
  try {
    saveDraft(localStorage, session.exportDraft());
    isDraftSaveFailing = false;
    clearDraftProblem();
  } catch (error) {
    isDraftSaveFailing = true;
    showDraftProblem(`Draft not saved: ${error.message}. Export your changes before leaving.`);
  }
}

// Everything that depends on the session, after any recorded change.
function showSessionChange() {
  persistDraft();
  refreshOverlay();
  clearSelection();
  showLoadingStatus();
  renderCommandAvailability();
  renderFeatureCounts();
}

function travelHistory(travel) {
  const changedKey = travel();
  if (changedKey !== null) showSessionChange();
}

// New places get a local identity and no upstream claims, which is what the importer requires of them. Their level starts
// unchosen: a default that differs from the policy would become an override credited to someone who never chose it.
function startNewFeature() {
  clearSelection();
  const localId = `local:${crypto.randomUUID()}`;
  if (activeFile === 'places.geojson') {
    editing.openNewPoint(localId, {id: localId, source: rules.localPlaceSource});
  } else {
    editing.openNewLine(localId, {});
  }
  elementById('selection-title').textContent = addFeatureLabels[activeFile];
  elementById('selection-source').textContent = `${activeFile} · new feature`;
}

// Mode identity is the canonical filename. No object-type mode or cross-file selection exists.
function setMode(filename) {
  // A geometry preview is dropped by a mode switch, but typed details must be applied or discarded explicitly.
  if (editing.hasTypedDetails) {
    editing.showProblem(applyOrCancelMessage);
    elementById('status').textContent = applyOrCancelMessage;
    return;
  }
  editing.close();
  activeFile = activeFile === filename ? null : filename;
  maskPublishedLayer(activeFile);
  refreshOverlay();
  clearSelection();
  showLoadingStatus();
  renderCommandAvailability();
  renderAddFeature();
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === activeFile));
  }
  for (const row of document.querySelectorAll('[data-source]')) {
    row.setAttribute('aria-current', String(row.dataset.source === activeFile));
  }
}

// Builds one table row and one mode switch per verified source file.
function renderLayers() {
  for (const [filename, source] of sources) {
    const row = document.createElement('tr');
    row.dataset.source = filename;
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = filename;
    const count = document.createElement('td');
    count.textContent = source.metadata.featureCount;
    row.append(name, count);
    elementById('layers').append(row);
    const button = document.createElement('button');
    button.dataset.mode = filename;
    button.textContent = layerNames[filename];
    button.setAttribute('aria-label', `${layerNames[filename]} · ${filename}`);
    button.setAttribute('aria-pressed', 'false');
    const label = document.createElement('small');
    label.textContent = filename;
    button.append(label);
    button.onclick = () => setMode(filename);
    elementById('modes').append(button);
  }
}

// setData finishes in a worker. MapLibre reports idle only once the current data has rendered.
function finishModeLoading() {
  if (!isModeLoading) return;
  isModeLoading = false;
  elementById('status').textContent = modeStatus();
}

// Clicks wait for the mode to finish loading, and a hit from another file never selects anything.
function selectFeatureAtClick(event) {
  if (!activeFile || isModeLoading) return;
  if (editing.hasGeometryTool) {
    editing.tap(event);
    return;
  }
  // A stray tap must not silently throw away typed details.
  if (editing.hasUnappliedEdit) {
    elementById('status').textContent = applyOrCancelMessage;
    return;
  }
  const hit = hitTest(map, event.point, overlay.layerIds)[0];
  const entries = session.workingEntries(activeFile);
  const features = entries.map(({feature}) => feature);
  const feature = sourceFeatureForHit(hit, activeFile, features);
  if (!feature) {
    clearSelection();
    return;
  }
  showFeature(feature, entries[hit.id].key);
}

// Shows drafts that could not be resumed. They stay in their own storage slot until someone decides. A draft that could
// not even be moved there is offered too, because it blocks autosave until someone does.
function offerSetAsideDrafts() {
  const setAsideDrafts = readSetAsideDrafts(localStorage);
  const blockingDraft = isDraftSavingBlocked
    ? [{reason: 'it could not be set aside', text: readSavedDraftText(localStorage)}]
    : [];
  const drafts = [...setAsideDrafts, ...blockingDraft];
  elementById('draft-conflict').hidden = drafts.length === 0;
  elementById('draft-conflict-actions').hidden = drafts.length === 0;
  if (drafts.length === 0) return;
  const reasons = drafts.map(({reason}) => reason).join('; ');
  elementById('draft-conflict').textContent = `A saved draft was not applied: ${reasons}.`;
  elementById('draft-download').onclick = () => downloadJSON('editor-set-aside-drafts.json', drafts);
  elementById('draft-discard').onclick = () => discardSetAsideDrafts();
}

// This can be the only copy, so it asks first. Then it saves right away: edits applied while autosave was off, or while
// storage was full, exist nowhere else, and a reload would lose them.
function discardSetAsideDrafts() {
  if (!confirm('Discard the old draft? It cannot be recovered unless you downloaded it.')) return;
  clearSetAsideDrafts(localStorage);
  if (isDraftSavingBlocked) removeSavedDraft(localStorage);
  isDraftSavingBlocked = false;
  offerSetAsideDrafts();
  persistDraft();
  renderCommandAvailability();
}

// A broken or blocked saved draft must not stop the editor from opening. If it could not be moved aside, autosave
// stays off, because the next save would overwrite the only copy.
function restoreSavedDraft() {
  try {
    const draft = openSavedDraft(localStorage, sources);
    if (draft) {
      session.restoreDraft(draft);
      review.showMessage('Restored your saved draft.');
    }
  } catch (error) {
    isDraftSavingBlocked = true;
    showDraftProblem(`Saved draft not restored, and new changes will not be saved: ${error.message}`);
  }
  try {
    offerSetAsideDrafts();
  } catch (error) {
    showError(new Error(`Saved drafts cannot be read: ${error.message}`));
  }
}

// Only on the change itself: this runs on every pointer move of a drag, and rendering the review panel each time would
// be slow and collapse the sections someone is reading.
function renderCommandsWhenEditOpensOrCloses() {
  if (!review || editing.hasUnappliedEdit === wasEditOpen) return;
  wasEditOpen = editing.hasUnappliedEdit;
  renderCommandAvailability();
}

function startEditing(visibilityConfig) {
  const levels = new Set(visibilityConfig.levels.map(({level}) => level));
  session = new EditSession(sources);
  commands = createActiveFileCommands(session, () => activeFile);
  editing = new InspectorEditing({
    commands,
    session,
    rules,
    levels,
    overlay,
    map,
    handles: createHandleLayer(map),
    activeFile: () => activeFile,
    onRecorded: showSessionChange,
    onClosed: clearSelection,
    onEditStateChanged: renderCommandsWhenEditOpensOrCloses
  });
  review = new ReviewPanel({
    session,
    sources,
    rules,
    levels,
    hasOpenEdit: () => editing.hasUnappliedEdit,
    onChanged: showSessionChange
  });
  editing.registerActions();
  review.registerActions();
  elementById('undo').onclick = () => travelHistory(commands.undo);
  elementById('redo').onclick = () => travelHistory(commands.redo);
  elementById('add-feature').onclick = startNewFeature;
  restoreSavedDraft();
  review.render();
}

function toggleSatellite() {
  isSatelliteVisible = !isSatelliteVisible;
  setSatelliteVisible(map, isSatelliteVisible);
  elementById('satellite').setAttribute('aria-pressed', String(isSatelliteVisible));
  if (isSatelliteVisible) map.fitBounds(satelliteBounds, {duration: 0, padding: 20});
}

// Sources are verified before the map starts, so a mode can never open on unverified data.
async function start() {
  const canReloadNow = () => !editing?.hasUnappliedEdit && !(session && hasOnlyInMemoryChanges());
  startOfflineCopy(canReloadNow, () => Boolean(map?.loaded()));
  const [bundle, mapMetadata, visibilityConfig, layerRules] = await Promise.all([
    loadSourceBundle(new URL('sources/', location.href)),
    loadJSON('data/map.json'),
    loadJSON('data/place-visibility.json'),
    loadJSON('data/editor-layers.json')
  ]);
  sources = bundle;
  rules = validateLayerRules(layerRules, [...sources.keys()]);
  if (!archiveFilenamePattern.test(mapMetadata.archive)) throw new Error('Invalid map archive metadata.');
  registerArchiveProtocol(maplibregl, pmtiles);
  const basemapURL = 'pmtiles://' + new URL(`data/${mapMetadata.archive}`, location.href).href;
  map = createMap({engine: maplibregl, container: 'map', basemapURL, assetBaseURL: location.href});
  // Exposed for browser tests and manual inspection, like the public app's kompasDebug.
  window.editorDebug = {
    get map() {
      return map;
    }
  };
  map.on('error', event => showError(event.error ?? new Error('Map asset failed.')));
  await whenMapReady(map);
  installPlaces(map, sources.get('places.geojson').collection.features, parseVisibilityConfig(visibilityConfig));
  overlay = createGeoJSONOverlay(map, 'editor-source');
  startEditing(visibilityConfig);
  map.on('click', selectFeatureAtClick);
  map.on('idle', finishModeLoading);
  renderLayers();
  renderFeatureCounts();
  elementById('browse').disabled = false;
  elementById('browse').onclick = () => setMode(null);
  elementById('satellite').disabled = false;
  elementById('satellite').onclick = toggleSatellite;
  setMode(null);
}

start().catch(showError);
