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
import {EditPreview, hiddenLayerFilter} from './edit-preview.js';
import {EditSession} from './edit-session.js';
import {createHandleLayer} from './handle-layer.js';
import {InspectorEditing} from './inspector-editing.js';
import {startOfflineCopy} from './offline-install.js';
import {featureCapabilities, layerLockReason, validateLayerRules} from './layer-rules.js';
import {ReviewPanel} from './review-panel.js';
import {loadSourceBundle} from './source-bundle.js';
import {installInspectorViewport} from './inspector-viewport.js';
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
// The panels occupy at most 320 + 340 px; 660 / 0.4 leaves 60% of a 1650 px window for the map.
const sharedPanelSpace = matchMedia('(max-width: 1650px)');
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
let preview;
let panelOpener = null;

// Status messages declare whether they need to be visible over the map.
function setStatus(message, needsAttention = false) {
  const status = elementById('status');
  status.textContent = message;
  status.classList.toggle('attention', needsAttention);
}

// Errors stay on screen even when part of the map rendered successfully.
function showError(error) {
  isDraftProblemShown = false;
  elementById('error').textContent = error.message;
  elementById('error').hidden = false;
  setStatus('Source viewer needs attention', true);
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
  setStatus(modeStatus());
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// The status for what the map shows, with nothing selected and fully rendered: Browse, the preview or the active mode.
function modeStatus() {
  if (preview?.isShown) {
    const changedFileCount = session.changedFiles().length;
    if (changedFileCount === 0) return 'Preview · no edits yet';
    const fileWord = changedFileCount === 1 ? 'file' : 'files';
    return `Preview · edits in ${changedFileCount} ${fileWord} applied`;
  }
  if (!activeFile) return 'Browse · all source files locked';
  const featureCount = session.workingEntries(activeFile).length;
  const access = layerLockReason(rules.layers[activeFile]) ? 'read-only' : 'editable';
  return `${activeFile} · ${featureCount} source features · ${access}`;
}

// The inspector is an overlay in either layout, so selection never changes the map view.
function selectionStatus(index) {
  return `${activeFile} · feature ${index} selected`;
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
  showInspector();
  const properties = feature.properties;
  const hash = sources.get(activeFile).metadata.sha256;
  elementById('selection-title').textContent =
    properties.name || properties['addr:housenumber'] || feature.geometry.type;
  elementById('selection-source').textContent = `${activeFile} · feature ${index}`;
  elementById('identity').textContent = `Pinned source SHA-256: ${hash}. Feature indices are revision-bound.`;
  elementById('source-id').textContent = feature.id === undefined ? '' : `Source feature ID: ${feature.id}`;
  elementById('properties').replaceChildren();
  for (const [name, value] of Object.entries(properties)) appendProperty(name, value);
  elementById('selection-details').open = false;
  elementById('open-inspector').textContent = `Selection: ${elementById('selection-title').textContent}`;
  setStatus(selectionStatus(index));
  overlay.setSelection(feature);
  const {canModify, lockReason} = featureCapabilities(feature, rules.layers[activeFile]);
  showLockReason(lockReason);
  if (canModify) editing.openExisting(index, feature);
}

// Returns the inspector to its empty state for the active mode.
function clearSelection() {
  editing.close();
  elementById('open-inspector').hidden = true;
  elementById('selection-details').open = false;
  elementById('open-inspector').setAttribute('aria-expanded', 'false');
  document.querySelector('.inspector').hidden = true;
  showLockReason(activeFile ? layerLockReason(rules.layers[activeFile]) : null);
  elementById('selection-title').textContent = 'Select an object';
  elementById('selection-source').textContent = activeFile
    ? `Inspecting ${activeFile}`
    : 'Choose a file mode, then select its geometry on the map.';
  elementById('properties').replaceChildren();
  elementById('identity').textContent = '';
  elementById('source-id').textContent = '';
  setStatus(modeStatus());
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
  if (isModeLoading) setStatus(`Loading ${activeFile}…`, true);
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
  if (preview.isShown) showPreview();
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
  showInspector();
  elementById('selection-title').textContent = addFeatureLabels[activeFile];
  elementById('selection-source').textContent = `${activeFile} · new feature`;
  elementById('open-inspector').textContent = `Selection: ${addFeatureLabels[activeFile]}`;
}

// Mode identity is the canonical filename. No object-type mode or cross-file selection exists.
function setMode(filename) {
  // A geometry preview is dropped by a mode switch, but typed details must be applied or discarded explicitly.
  if (editing.hasTypedDetails) {
    showInspector();
    editing.showProblem(applyOrCancelMessage);
    setStatus(applyOrCancelMessage, true);
    return false;
  }
  editing.close();
  if (preview.isShown) hidePreview();
  activeFile = activeFile === filename ? null : filename;
  elementById('current-layer').textContent = activeFile ? layerNames[activeFile] : 'Browse';
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
  return true;
}

// Choosing a layer closes its picker only after the mode switch succeeds.
function chooseMode(filename) {
  if (!setMode(filename)) return;
  showPanel(null);
  elementById('current-layer').focus();
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
    button.onclick = () => chooseMode(filename);
    elementById('modes').append(button);
  }
}

// setData finishes in a worker. MapLibre reports idle only once the current data has rendered.
function finishModeLoading() {
  if (!isModeLoading) return;
  isModeLoading = false;
  setStatus(modeStatus());
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
    setStatus(applyOrCancelMessage, true);
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
  elementById('draft-notice').hidden = drafts.length === 0;
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
    releaseInspectorFocus: () => {
      const hadFocus = document.querySelector('.inspector').contains(document.activeElement);
      if (hadFocus) elementById('current-layer').focus({preventScroll: true});
      return hadFocus;
    },
    focusStatus: () => elementById('status').focus(),
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

// Every changed file with all its working features, which is what a rebuild would publish.
function workingFeaturesOfChangedFiles() {
  const changedFiles = session.changedFiles();
  return new Map(changedFiles.map(filename => [filename, session.workingEntries(filename).map(({feature}) => feature)]));
}

// The status waits for the map to draw, as a mode switch does: on the largest files that takes seconds.
function showPreview() {
  try {
    preview.show(workingFeaturesOfChangedFiles());
  } catch (error) {
    hidePreview();
    showError(new Error(`Preview failed: ${error.message}`));
    return;
  }
  elementById('preview').setAttribute('aria-pressed', 'true');
  isModeLoading = true;
  setStatus('Loading preview…', true);
}

function hidePreview() {
  preview.hide();
  elementById('preview').setAttribute('aria-pressed', 'false');
}

// Preview shows every file at once, so it starts from Browse, where nothing can be edited.
function togglePreview() {
  if (preview.isShown) {
    hidePreview();
    setStatus(modeStatus());
    return;
  }
  setMode(null);
  const isModeSwitchRefused = activeFile !== null;
  if (isModeSwitchRefused) return;
  showPreview();
}

function toggleSatellite() {
  isSatelliteVisible = !isSatelliteVisible;
  setSatelliteVisible(map, isSatelliteVisible);
  elementById('satellite').setAttribute('aria-pressed', String(isSatelliteVisible));
  if (isSatelliteVisible) map.fitBounds(satelliteBounds, {duration: 0, padding: 20});
}

// Utility panels share space without changing the map or the pending edit.
function showPanel(panelId, opener = null) {
  if (panelId) panelOpener = opener;
  for (const panel of document.querySelectorAll('.utility-panel')) {
    panel.hidden = panel.id !== panelId;
  }
  for (const button of document.querySelectorAll('[data-panel]')) {
    button.setAttribute('aria-expanded', String(button.dataset.panel === panelId));
  }
  elementById('current-layer').setAttribute('aria-expanded', String(panelId === 'layers-panel'));
  if (panelId && sharedPanelSpace.matches && !document.querySelector('.inspector').hidden) {
    collapseInspector(false);
  }
}

// Hiding the inspector only changes its presentation; the edit remains in memory.
function showInspector() {
  if (sharedPanelSpace.matches) showPanel(null);
  document.querySelector('.inspector').hidden = false;
  elementById('open-inspector').hidden = true;
  elementById('open-inspector').setAttribute('aria-expanded', 'true');
}

// Collapse one panel when a resize would leave too little map visible.
function installPanelResize() {
  sharedPanelSpace.addEventListener('change', event => {
    const hasOpenPanel = [...document.querySelectorAll('.utility-panel')].some(panel => !panel.hidden);
    const inspector = document.querySelector('.inspector');
    if (event.matches && hasOpenPanel && !inspector.hidden) {
      collapseInspector(inspector.contains(document.activeElement));
    }
  });
}

// Panel buttons use the same space and preserve the selected edit.
function installPanelButtons() {
  for (const button of document.querySelectorAll('[data-panel]')) {
    button.disabled = false;
    button.onclick = event => {
      const panelId = button.dataset.panel;
      showPanel(elementById(panelId).hidden ? panelId : null, event.currentTarget);
    };
  }
  elementById('current-layer').disabled = false;
  elementById('current-layer').onclick = event => {
    showPanel(elementById('layers-panel').hidden ? 'layers-panel' : null, event.currentTarget);
  };
  elementById('offline-notice').onclick = event => showPanel('layers-panel', event.currentTarget);
  elementById('draft-notice').onclick = event => showPanel('changes-panel', event.currentTarget);
}

// Collapse changes presentation only. Explicit Cancel owns discarding the edit.
function collapseInspector(shouldFocus = true) {
  document.querySelector('.inspector').hidden = true;
  const opener = elementById('open-inspector');
  opener.hidden = false;
  opener.setAttribute('aria-expanded', 'false');
  if (shouldFocus) opener.focus();
}

// Native buttons provide keyboard opening and applying; Escape closes the foremost panel without discarding work.
function installInspectorToggle() {
  elementById('close-inspector').onclick = () => collapseInspector();
  elementById('open-inspector').onclick = () => {
    showInspector();
    elementById('close-inspector').focus();
  };
  document.addEventListener('keydown', event => {
    const isImeKey = event.isComposing || event.keyCode === 229;
    if (event.key !== 'Escape' || event.defaultPrevented || isImeKey) return;
    if (editing?.cancelActiveGesture()) {
      event.preventDefault();
      return;
    }
    const inspector = document.querySelector('.inspector');
    if (!inspector.hidden && inspector.contains(document.activeElement)) {
      event.preventDefault();
      collapseInspector();
      return;
    }
    const openPanel = [...document.querySelectorAll('.utility-panel')].find(panel => !panel.hidden);
    if (openPanel) {
      event.preventDefault();
      const opener = panelOpener;
      showPanel(null);
      const isOpenerVisible = opener?.checkVisibility?.() ?? Boolean(opener?.getClientRects().length);
      if (isOpenerVisible) opener.focus();
      else document.querySelector(`[data-panel="${openPanel.id}"]`).focus();
      return;
    }
    if (!inspector.hidden) {
      event.preventDefault();
      collapseInspector();
    }
  });
}

// Install workspace interactions before asynchronous startup begins.
function installWorkspaceControls() {
  installPanelResize();
  installPanelButtons();
  installInspectorToggle();
  installInspectorViewport();
}

// Sources are verified before the map starts, so a mode can never open on unverified data.
async function start() {
  installWorkspaceControls();
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
  // MapLibre 5.12 opens compact attribution at startup; keep its details and class in sync when collapsing it.
  const attribution = document.querySelector('.maplibregl-ctrl-attrib');
  if (attribution instanceof HTMLDetailsElement) {
    attribution.open = false;
    attribution.classList.remove('maplibregl-compact-show');
  }
  const placeVisibility = parseVisibilityConfig(visibilityConfig);
  const publishedPlaces = sources.get('places.geojson').collection.features;
  installPlaces(map, publishedPlaces, placeVisibility);
  preview = new EditPreview({map, basemapLayers, visibilityConfig: placeVisibility, publishedPlaces});
  overlay = createGeoJSONOverlay(map, 'editor-source');
  startEditing(visibilityConfig);
  map.on('click', selectFeatureAtClick);
  map.on('idle', finishModeLoading);
  renderLayers();
  renderFeatureCounts();
  elementById('browse').disabled = false;
  elementById('browse').onclick = () => chooseMode(null);
  elementById('satellite').disabled = false;
  elementById('satellite').onclick = toggleSatellite;
  elementById('preview').disabled = false;
  elementById('preview').onclick = togglePreview;
  setMode(null);
}

start().catch(showError);
