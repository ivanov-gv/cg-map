import {
  archiveFilenamePattern,
  createMap,
  hitTest,
  installPlaces,
  parseVisibilityConfig,
  registerArchiveProtocol,
  satelliteBounds,
  setSatelliteVisible,
  whenMapReady
} from '@ivanov-gv/map-core';
import {createActiveLayerCommands} from './active-layer-commands.js';
import {DraftKeeper} from './draft-keeper.js';
import {createElementWithText, elementById} from './dom.js';
import {EditSession} from './edit-session.js';
import {availableLayers, isLayerObject} from './editor-layers.js';
import {isReferencedObject, newDeletionMark} from './field-items.js';
import {createHandleLayer} from './handle-layer.js';
import {InspectorEditing} from './inspector-editing.js';
import {installInspectorViewport} from './inspector-viewport.js';
import {installKeyboardShortcuts, updateShortcutHints} from './keyboard-shortcuts.js';
import {addressBehaviors, gapBehaviors, layerFilters, nearestGap} from './layer-addresses.js';
import {behaviorOf, drawChoicesOf, newFeatureFields, registerBehaviors} from './layer-behaviors.js';
import {buildingBehaviors} from './layer-buildings.js';
import {buildingAt, placeBehaviors} from './layer-places.js';
import {greenBehaviors} from './layer-green.js';
import {reliefBehaviors} from './layer-relief.js';
import {roadBehaviors} from './layer-roads.js';
import {settlementBehaviors} from './layer-settlements.js';
import {waterBehaviors} from './layer-water.js';
import {featureCapabilities, layerLockReason, validateLayerRules} from './layer-rules.js';
import {renderFeatureCounts, renderLayerChoices, renderSourceTable, showActiveLayer} from './layers-panel.js';
import {hideModeBar, showModeBar} from './mode-bar.js';
import {ObjectList} from './object-list.js';
import {startOfflineCopy} from './offline-install.js';
import {ReviewPanel} from './review-panel.js';
import {loadSourceBundle} from './source-bundle.js';
import {createSourceOverlay, guideMinZoom, overlayCollection, sourceEntriesForHits} from './source-overlay.js';
import {hideToast, showToast} from './toast.js';
import {WorkingMap} from './working-map.js';
import {
  hideInspector,
  inspectorHasFocus,
  installWorkspace,
  setPanelOpener,
  showInspector,
  showPanel
} from './workspace-panels.js';

registerBehaviors(buildingBehaviors);
registerBehaviors(addressBehaviors);
registerBehaviors(placeBehaviors);
registerBehaviors(roadBehaviors);
registerBehaviors(greenBehaviors);
registerBehaviors(waterBehaviors);
registerBehaviors(reliefBehaviors);
registerBehaviors(settlementBehaviors);
registerBehaviors(gapBehaviors, 'addresses');

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
// The width at which the workspace becomes the phone one, as in style.css.
const phoneLayout = matchMedia('(max-width: 720px)');
let map;
let sources;
let overlay;
let workingMap;
let layers = [];
let activeLayer = null;
let activeEntries = [];
let areGuidesVisible = true;
let isSatelliteVisible = false;
let isLayerLoading = false;
let rules;
let levels;
let session;
let editing;
let review;
let commands;
let drafts;
let wasEditOpen = false;
let pendingLayer = null;
let objectList;
let clickCandidates = null;
let pendingPick = null;
let activeFilter = null;
let pendingSelection = null;
const skippedGapKeys = new Set();

// Status messages declare whether they need to be visible over the map.
function setStatus(message, needsAttention = false) {
  const status = elementById('status');
  status.textContent = message;
  status.classList.toggle('attention', needsAttention);
}

// Errors stay on screen even when part of the map rendered successfully.
function showError(error) {
  drafts?.forgetShownProblem();
  elementById('error').textContent = error.message;
  elementById('error').hidden = false;
  setStatus('Editor needs attention', true);
}

function clearError() {
  elementById('error').hidden = true;
  setStatus(layerStatus());
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// The status for what the map shows, with nothing selected and fully rendered.
function layerStatus() {
  if (!activeLayer) return 'Browse · choose a layer to edit';
  const objectCount = activeEntries.filter(isPickable).length;
  if (activeFilter) return `${activeFilter.heading} · ${objectCount} objects`;
  const isEditable = activeLayer.files.some(filename => !layerLockReason(rules.layers[filename]));
  return `${activeLayer.name} · ${objectCount} objects · ${isEditable ? 'editable' : 'read-only'}`;
}

// Kinds that only follow from other objects are drawn and never picked.
const isPickable = ({filename, feature}) => isLayerObject(filename, feature);

// What a layer's behavior may read, never a way around the commands.
function behaviorContext() {
  return {
    session,
    rules,
    levels,
    map,
    layer: activeLayer,
    isPhone: () => phoneLayout.matches,
    entriesOf: filename => (sources.has(filename) ? session.workingEntries(filename) : []),
    findEntity: (filename, entityId) =>
      behaviorContext()
        .entriesOf(filename)
        .find(({key, feature}) => key === entityId || feature.properties.entityId === entityId),
    select: entry => selectObject(entry, true),
    startNew: startNewFeature,
    pick: pickObject,
    showNextGap
  };
}

function appendProperty(name, value) {
  const valueText = typeof value === 'object' ? JSON.stringify(value) : String(value);
  elementById('properties').append(createElementWithText('dt', name), createElementWithText('dd', valueText));
}

function showLockReason(reason) {
  elementById('lock-reason').textContent = reason ?? '';
  elementById('lock-reason').hidden = !reason;
}

function setHeading(kind, title) {
  elementById('selection-kind').textContent = kind;
  elementById('selection-title').textContent = title;
  elementById('open-inspector').textContent = `Selection: ${title}`;
}

// Objects are selected from full source geometry, never clipped tile coordinates. Upstream IDs are
// shown here because overlay features use the array index as their ID instead.
function showFeature(entry) {
  const {filename, key, feature} = entry;
  editing.close();
  showInspector();
  const behavior = behaviorOf(filename, activeLayer.id);
  setHeading(behavior.kind(feature), behavior.title(feature, behaviorContext()));
  const hash = sources.get(filename).metadata.sha256;
  elementById('selection-source').textContent = `${filename} · feature ${key}`;
  elementById('identity').textContent = `Pinned source SHA-256: ${hash}. Feature indices are revision-bound.`;
  elementById('source-id').textContent = feature.id === undefined ? '' : `Source feature ID: ${feature.id}`;
  elementById('properties').replaceChildren();
  for (const [name, value] of Object.entries(feature.properties)) appendProperty(name, value);
  elementById('selection-details').open = false;
  setStatus(`${activeLayer.name} · feature ${key} selected`);
  overlay.setSelection(feature.geometry ? feature : null);
  const {canModify, lockReason} = featureCapabilities(feature, rules.layers[filename]);
  showLockReason(lockReason);
  if (canModify) editing.openExisting(entry);
}

// Returns the inspector to its empty state for the active layer.
function clearSelection() {
  editing.close();
  hideInspector();
  elementById('selection-details').open = false;
  showLockReason(null);
  setHeading('', 'Select an object');
  elementById('selection-source').textContent = '';
  elementById('properties').replaceChildren();
  elementById('identity').textContent = '';
  elementById('source-id').textContent = '';
  setStatus(layerStatus());
}

// A filter shows other objects over the map as it is, without drawing the files of its layer again.
const shownFiles = () => {
  if (activeFilter) return [];
  const isLimited = phoneLayout.matches && activeLayer?.phoneFiles;
  return (isLimited ? activeLayer.phoneFiles : activeLayer?.files) ?? [];
};

// The active layer's files and every changed file use the public cartography with their working features. The others
// stay as released, for context.
function workingFeatures(displayFeatures) {
  const featuresByFile = new Map();
  for (const filename of shownFiles()) {
    featuresByFile.set(filename, displayFeatures.filter(({properties}) => properties.sourceFile === filename));
  }
  for (const filename of session.changedFiles()) {
    if (featuresByFile.has(filename)) continue;
    featuresByFile.set(filename, session.workingEntries(filename).map(({feature}) => feature));
  }
  return featuresByFile;
}

function changedFeaturesOf(filename) {
  return session.changes(filename).map(({after}) => after).filter(feature => feature?.geometry);
}

// Objects marked in the field, drawn as "to delete" until the desk confirms them.
function markedFeatures() {
  return session
    .fieldItems()
    .filter(({type, geometry}) => type === 'deletion' && geometry)
    .map(({geometry}) => ({type: 'Feature', properties: {}, geometry}));
}

function refreshOverlay() {
  clickCandidates = null;
  workingMap.hide();
  activeEntries = activeFilter
    ? activeFilter.entries(behaviorContext())
    : shownFiles().flatMap(filename => session.workingEntries(filename));
  const changedFeatures = new Set(session.changedFiles().flatMap(changedFeaturesOf));
  const stateOf = entry => {
    if (activeFilter) return activeFilter.state;
    if (!isPickable(entry)) return 'context';
    return changedFeatures.has(entry.feature) ? 'applied' : 'editable';
  };
  const collection = overlayCollection(activeEntries, stateOf);
  overlay.setData(collection);
  overlay.setInteriorsPickable(Boolean(activeFilter));
  const otherChangedFiles = session.changedFiles().filter(filename => !shownFiles().includes(filename));
  overlay.setApplied(otherChangedFiles.flatMap(changedFeaturesOf));
  overlay.setDeletions(markedFeatures());
  overlay.setGuideMinZoom(activeLayer?.guideMinZoom ?? guideMinZoom, activeLayer?.pointGuideMinZoom);
  try {
    workingMap.show(workingFeatures(collection.features), new Set(shownFiles()));
  } catch (error) {
    showError(new Error(`Drawing the changes failed: ${error.message}`));
  }
}

// Toggling presentation preserves the open edit; clicks wait until the new visibility has rendered.
function toggleGuides() {
  areGuidesVisible = !areGuidesVisible;
  clickCandidates = null;
  overlay.setGuidesVisible(areGuidesVisible);
  elementById('edit-guides').setAttribute('aria-pressed', String(areGuidesVisible));
  showLoadingStatus();
}

// setData finishes in a worker. MapLibre reports idle only once the current data has rendered.
function showLoadingStatus() {
  isLayerLoading = activeLayer !== null;
  if (isLayerLoading) setStatus(`Loading ${activeLayer.name}…`, true);
  renderObjectList();
}

function finishLayerLoading() {
  if (isLayerLoading) {
    isLayerLoading = false;
    setStatus(layerStatus());
  }
  if (pendingSelection) {
    const entry = pendingSelection;
    pendingSelection = null;
    selectObject(entry, true);
  }
  renderObjectList();
}

function renderChangeCount() {
  const count = session.changeCount() + session.fieldItems().length;
  elementById('change-count').textContent = String(count);
  elementById('change-count').hidden = count === 0;
}

// History or a new feature would replace an open edit, so they wait, as export, import and discarding do.
function renderCommandAvailability() {
  const isIdleInLayer = activeLayer && !editing.hasUnappliedEdit;
  elementById('undo').disabled = !isIdleInLayer || !session.canUndo(activeLayer.id);
  elementById('redo').disabled = !isIdleInLayer || !session.canRedo(activeLayer.id);
  for (const button of elementById('draw-choices').children) button.disabled = !isIdleInLayer;
  // Updating reloads the page, which would lose an edit not applied yet, or applied edits that could not be saved.
  elementById('update-app').disabled = editing.hasUnappliedEdit || drafts.hasOnlyInMemoryChanges();
  elementById('update-hint').hidden = !session.hasChanges();
  renderChangeCount();
  review.render();
}

function renderTools() {
  elementById('edit-guides').hidden = !activeLayer;
  elementById('edit-guides-hint').hidden = !activeLayer;
  const buttons = drawChoicesOf(activeLayer, rules).map(choice => {
    const button = createElementWithText('button', choice.label);
    button.type = 'button';
    button.onclick = () => startNewFeature(choice);
    return button;
  });
  const filterButtons = (layerFilters[activeLayer?.id] ?? []).map(filter => {
    const button = createElementWithText('button', filter.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(activeFilter?.id === filter.id));
    button.onclick = () => toggleFilter(filter);
    return button;
  });
  elementById('draw-choices').replaceChildren(...buttons, ...filterButtons);
}

// Shows other objects of the layer's work, such as the buildings without a number, or its own again.
function toggleFilter(filter) {
  clearSelection();
  skippedGapKeys.clear();
  activeFilter = activeFilter?.id === filter.id ? null : filter;
  refreshOverlay();
  showLoadingStatus();
  renderTools();
  renderCommandAvailability();
  if (activeFilter) showPanel(null);
}

// Selects once the layer has drawn, bringing the object into view.
function selectWhenReady(entry) {
  const {geometry} = entry.feature;
  if (geometry && !map.getBounds().contains(centreOf(geometry))) map.jumpTo({center: centreOf(geometry)});
  if (isLayerLoading || map.isMoving()) pendingSelection = entry;
  else selectObject(entry, true);
}

// The nearest building without a number, after one was saved or skipped.
function showNextGap(feature, skippedKey = null) {
  if (!activeFilter) return;
  if (skippedKey) skippedGapKeys.add(skippedKey);
  const next = nearestGap(activeEntries, feature.geometry.coordinates[0][0], skippedGapKeys);
  if (next) selectWhenReady(next);
  else showToast('No more buildings without a number');
}

// Everything that depends on the session, after any recorded change.
function showSessionChange() {
  drafts.persist();
  refreshOverlay();
  clearSelection();
  showLoadingStatus();
  renderCommandAvailability();
  renderFeatureCounts(filename => session.workingEntries(filename).length);
}

// After Apply the map shows the result at once, and one tap takes it back.
function showApplied(message) {
  showSessionChange();
  if (message) showToast(message, {action: () => travelHistory(commands.undo)});
}

function travelHistory(travel) {
  if (!activeLayer || editing.hasUnappliedEdit) return;
  if (travel() !== null) showSessionChange();
}

// Field items have no history of their own, so each change of them carries its way back.
function changeFieldItems(change, message, undoChange) {
  change();
  showSessionChange();
  const undo = () => {
    undoChange();
    showSessionChange();
  };
  showToast(message, {action: undo});
}

function markForDeletion(entry, name) {
  const item = newDeletionMark(entry, name, activeLayer.id);
  changeFieldItems(
    () => session.saveFieldItem(item),
    'Marked for deletion',
    () => session.removeFieldItem(item.id)
  );
}

function dismissFieldItem(item) {
  changeFieldItems(
    () => session.removeFieldItem(item.id),
    'Dismissed',
    () => session.saveFieldItem(item)
  );
}

function centreOf(geometry) {
  const flat = geometry.type === 'Point' ? [geometry.coordinates] : geometry.coordinates.flat(Infinity);
  if (geometry.type === 'Point') return flat[0];
  const longitudes = flat.filter((_value, index) => index % 2 === 0);
  const latitudes = flat.filter((_value, index) => index % 2 === 1);
  const middle = values => (Math.min(...values) + Math.max(...values)) / 2;
  return [middle(longitudes), middle(latitudes)];
}

// The desk goes to the object on its own layer, where it decides.
function openFieldItem(item) {
  const layer = layers.find(({id}) => id === item.layer);
  if (layer && layer.id !== activeLayer?.id && !setLayer(layer)) return;
  if (item.geometry) map.jumpTo({center: centreOf(item.geometry), zoom: Math.max(map.getZoom(), guideMinZoom + 1)});
  const entry = item.target && activeEntries.find(candidate =>
    candidate.filename === item.target.filename && isReferencedObject(candidate, item.target.reference)
  );
  if (entry) selectWhenReady(entry);
}

// New objects get a local identity and no upstream claims, which is what the importer requires of them.
function startNewFeature({label, filename, shape, properties, geometry}) {
  clearSelection();
  showPanel(null);
  const localId = `local:${crypto.randomUUID()}`;
  const fields = newFeatureFields(filename, localId, rules);
  setHeading('New', label);
  elementById('selection-source').textContent = `${filename} · new feature`;
  if (geometry) showInspector();
  editing.openNew(filename, localId, shape, {...fields, geometry, properties: {...fields.properties, ...properties}});
}

// Exactly one layer is active, or none. The map keeps its position and zoom.
function setLayer(layer) {
  if (editing.hasUnappliedEdit) {
    pendingLayer = {layer};
    elementById('layer-switch-dialog').showModal();
    return false;
  }
  if (pendingPick) finishPick(null);
  editing.close();
  hideToast();
  activeFilter = null;
  pendingSelection = null;
  activeLayer = activeLayer?.id === layer?.id ? null : layer;
  elementById('current-layer-name').textContent = activeLayer ? activeLayer.name : 'Browse';
  elementById('current-layer').classList.toggle('has-layer', Boolean(activeLayer));
  refreshOverlay();
  clearSelection();
  showLoadingStatus();
  renderTools();
  renderCommandAvailability();
  showActiveLayer(activeLayer);
  return true;
}

// Choosing a layer closes its picker only after the switch succeeds.
function chooseLayer(layer) {
  if (setLayer(layer)) afterLayerSwitch();
}

function afterLayerSwitch() {
  showPanel(null);
  elementById('current-layer').focus();
}

// Only visible guides or normal cartography supply candidates, both for clicks and the keyboard list.
function selectableLayerIds() {
  if (activeFilter) return [overlay.interiorLayerId, ...overlay.layerIds];
  return [...workingMap.layerIds, ...overlay.inspectionLayerIds, ...(areGuidesVisible ? overlay.layerIds : [])];
}

const pickableEntries = hits => sourceEntriesForHits(hits, activeEntries).filter(isPickable);

// Rendered hits limit the directory to visible objects in the current map view. Objects without geometry have no place
// on the map, so they are always listed.
function renderObjectList() {
  if (!objectList || elementById('objects-panel').hidden) return;
  const heading = clickCandidates ? 'Choose an object here' : 'Objects in view';
  if (!activeLayer || isLayerLoading || map.isMoving()) {
    const message = activeLayer ? 'Loading objects…' : 'Choose a layer to list its objects.';
    objectList.render([], heading, message);
    return;
  }
  const hits = map.queryRenderedFeatures({layers: selectableLayerIds()});
  const unplacedEntries = activeEntries.filter(({feature}) => !feature.geometry);
  objectList.render(clickCandidates ?? [...pickableEntries(hits), ...unplacedEntries], heading, '');
}

// Returns whether selection succeeded, preserving unrelated panels and any unfinished edit.
function selectObject(entry, shouldFocus = false) {
  if (!activeLayer || isLayerLoading) return false;
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return false;
  }
  const feature = session.workingFeature(entry.filename, entry.key);
  if (!feature) return false;
  showFeature({...entry, feature});
  if (shouldFocus) elementById('close-inspector').focus();
  return true;
}

// Asks for one object of a file on the map. Gives its entry, or null when someone cancels or leaves the layer.
function pickObject(filename, prompt) {
  hideInspector();
  return new Promise(resolve => {
    pendingPick = {filename, resolve};
    const cancel = {id: 'mode-cancel', label: 'Cancel', run: () => finishPick(null)};
    showModeBar({title: prompt, hint: 'Tap it on the map', buttons: [cancel]});
  });
}

// What the layer shows there, or a shape of another file that contains the tap.
function entryUnderPick(event) {
  const {filename} = pendingPick;
  const hits = pickableEntries(hitTest(map, event.point, selectableLayerIds()));
  const shown = hits.find(entry => entry.filename === filename);
  if (shown || filename !== 'buildings.geojson') return shown;
  return buildingAt(event.lngLat.toArray(), behaviorContext());
}

function finishPick(entry) {
  const {resolve} = pendingPick;
  pendingPick = null;
  hideModeBar();
  if (!entry) showInspector();
  resolve(entry);
}

// Clicks wait for the layer to finish loading, and a hit from another file never selects anything.
function selectFeatureAtClick(event) {
  if (!activeLayer || isLayerLoading) return;
  if (pendingPick) {
    const picked = entryUnderPick(event);
    if (picked) finishPick(picked);
    return;
  }
  if (editing.hasGeometryTool) {
    editing.tap(event);
    return;
  }
  // A stray tap must not silently throw away typed details.
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return;
  }
  const candidates = pickableEntries(hitTest(map, event.point, selectableLayerIds()));
  const hadClickCandidates = clickCandidates !== null;
  clickCandidates = null;
  if (hadClickCandidates && !elementById('objects-panel').hidden) showPanel(null);
  if (candidates.length === 0) {
    clearSelection();
    return;
  }
  if (candidates.length === 1) {
    selectObject(candidates[0]);
    return;
  }
  clickCandidates = candidates;
  showPanel('objects-panel');
  setPanelOpener(elementById('open-objects'));
  renderObjectList();
  objectList.focusFirst();
}

// Only on the change itself: this runs on every pointer move of a drag, and rendering the review panel each time would
// be slow and collapse the sections someone is reading.
function renderCommandsWhenEditOpensOrCloses() {
  if (!review || editing.hasUnappliedEdit === wasEditOpen) return;
  wasEditOpen = editing.hasUnappliedEdit;
  renderCommandAvailability();
}

function createInspectorEditing() {
  return new InspectorEditing({
    commands,
    session,
    rules,
    levels,
    overlay,
    map,
    handles: createHandleLayer(map),
    isPhone: () => phoneLayout.matches,
    behaviorContext,
    onRecorded: showApplied,
    onClosed: clearSelection,
    onMarkedForDeletion: markForDeletion,
    showInspector,
    hideInspector,
    releaseInspectorFocus: () => {
      const hadFocus = inspectorHasFocus();
      if (hadFocus) elementById('current-layer').focus({preventScroll: true});
      return hadFocus;
    },
    focusStatus: () => elementById('status').focus(),
    onEditStateChanged: renderCommandsWhenEditOpensOrCloses
  });
}

function startEditing(visibilityConfig) {
  levels = new Set(visibilityConfig.levels.map(({level}) => level));
  session = new EditSession(sources);
  commands = createActiveLayerCommands(session, () => activeLayer);
  editing = createInspectorEditing();
  review = new ReviewPanel({
    session,
    sources,
    rules,
    levels,
    hasOpenEdit: () => editing.hasUnappliedEdit,
    onChanged: showSessionChange,
    onFieldItemChosen: openFieldItem,
    onFieldItemDismissed: dismissFieldItem
  });
  drafts = new DraftKeeper({
    session,
    sources,
    showError,
    clearError,
    onRestored: () => review.showMessage('Restored your saved draft.'),
    onSettled: renderCommandAvailability
  });
  editing.registerActions();
  review.registerActions();
  elementById('undo').onclick = () => travelHistory(commands.undo);
  elementById('redo').onclick = () => travelHistory(commands.redo);
  installKeyboardShortcuts();
  updateShortcutHints();
  drafts.restore();
  review.render();
}

function toggleSatellite() {
  isSatelliteVisible = !isSatelliteVisible;
  setSatelliteVisible(map, isSatelliteVisible);
  elementById('satellite').setAttribute('aria-pressed', String(isSatelliteVisible));
  if (isSatelliteVisible) map.fitBounds(satelliteBounds, {duration: 0, padding: 20});
}

function closeLayerSwitchDialog() {
  elementById('layer-switch-dialog').close();
  pendingLayer = null;
}

function completeLayerSwitch() {
  const {layer} = pendingLayer;
  closeLayerSwitchDialog();
  setLayer(layer);
  afterLayerSwitch();
}

function installLayerSwitchDialog() {
  elementById('layer-switch-apply').onclick = () => {
    if (editing.applyEdit().success) {
      completeLayerSwitch();
      return;
    }
    // Validation failed: close the dialog and show the inspector with the problem visible.
    closeLayerSwitchDialog();
    showInspector();
    elementById('edit-problem').focus();
  };
  elementById('layer-switch-discard').onclick = () => {
    editing.discardEdit();
    completeLayerSwitch();
  };
  elementById('layer-switch-keep').onclick = closeLayerSwitchDialog;
  // Escape means "Keep editing".
  elementById('layer-switch-dialog').addEventListener('cancel', event => {
    event.preventDefault();
    closeLayerSwitchDialog();
  });
}

function installWorkspaceControls() {
  installWorkspace({
    cancelActiveGesture: () => Boolean(editing?.cancelActiveGesture()),
    isSwitchDialogOpen: () => elementById('layer-switch-dialog').open,
    closeSwitchDialog: closeLayerSwitchDialog,
    leaveMode: () => Boolean(editing?.leaveModeOnEscape())
  });
  installLayerSwitchDialog();
  installInspectorViewport();
}

async function createEditorMap(mapMetadata) {
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
}

function installMapLayers(visibilityConfig) {
  const placeVisibility = parseVisibilityConfig(visibilityConfig);
  const publishedPlaces = sources.get('places.geojson').collection.features;
  installPlaces(map, publishedPlaces, placeVisibility);
  workingMap = new WorkingMap({
    map,
    basemapLayers,
    visibilityConfig: placeVisibility,
    publishedPlaces,
    sharedSource: 'editor-source'
  });
  overlay = createSourceOverlay(map);
}

function installMapInteraction() {
  objectList = new ObjectList(entry => {
    const isSelected = selectObject(entry, true);
    if (isSelected && !elementById('objects-panel').hidden) showPanel(null);
  });
  map.on('movestart', () => {
    clickCandidates = null;
    renderObjectList();
  });
  map.on('click', selectFeatureAtClick);
  map.on('dblclick', event => {
    if (editing.finishWithDoubleClick()) event.preventDefault();
  });
  map.on('idle', finishLayerLoading);
}

function enableControls() {
  elementById('browse').disabled = false;
  elementById('browse').onclick = () => {
    if (activeLayer) chooseLayer(activeLayer);
    else showPanel(null);
  };
  elementById('satellite').disabled = false;
  elementById('satellite').onclick = toggleSatellite;
  elementById('edit-guides').onclick = toggleGuides;
  elementById('open-objects').disabled = false;
  elementById('open-objects').onclick = event => {
    clickCandidates = null;
    showPanel('objects-panel', event.currentTarget);
    renderObjectList();
    objectList.focusFirst();
  };
}

// Sources are verified before the map starts, so a layer can never open on unverified data.
async function start() {
  installWorkspaceControls();
  const canReloadNow = () => !editing?.hasUnappliedEdit && !drafts?.hasOnlyInMemoryChanges();
  startOfflineCopy(canReloadNow, () => Boolean(map?.loaded()));
  const [bundle, mapMetadata, visibilityConfig, layerRules] = await Promise.all([
    loadSourceBundle(new URL('sources/', location.href)),
    loadJSON('data/map.json'),
    loadJSON('data/place-visibility.json'),
    loadJSON('data/editor-layers.json')
  ]);
  sources = bundle;
  rules = validateLayerRules(layerRules, [...sources.keys()]);
  layers = availableLayers([...sources.keys()]);
  await createEditorMap(mapMetadata);
  installMapLayers(visibilityConfig);
  startEditing(visibilityConfig);
  installMapInteraction();
  renderLayerChoices(layers, chooseLayer);
  renderSourceTable(sources);
  renderFeatureCounts(filename => session.workingEntries(filename).length);
  enableControls();
  setLayer(null);
}

start().catch(showError);
