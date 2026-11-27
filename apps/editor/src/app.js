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
import {createActiveLayerCommands} from './editing/active-layer-commands.js';
import {derivedFacts} from './source-data/derived-facts.js';
import {DraftKeeper} from './editing/draft-keeper.js';
import {createElementWithText, elementById} from './shared/dom.js';
import {EditSession} from './editing/edit-session.js';
import {availableLayers} from './layers/shared/editor-layers.js';
import {fieldItemLabel, isReferencedObject, newDeletionMark, newNote} from './editing/field-items.js';
import {createHandleLayer} from './map-tools/handle-layer.js';
import {createJointLayer, jointMinZoom} from './layers/shared/joint-layer.js';
import {InspectorEditing} from './inspector/inspector-editing.js';
import {installInspectorViewport} from './inspector/inspector-viewport.js';
import {installKeyboardShortcuts, updateShortcutHints} from './map-tools/keyboard-shortcuts.js';
import {addressBehaviors, gapBehaviors, layerFilters, nearestGap} from './layers/addresses/layer-addresses.js';
import {
  behaviorOf,
  createBehaviorContext,
  drawChoicesOf,
  newFeatureFields,
  registerBehaviors
} from './layers/shared/layer-behaviors.js';
import {buildingBehaviors} from './layers/buildings/layer-buildings.js';
import {featureForEntry, junctionBehaviors, junctionFile, junctionRule} from './layers/roads/layer-junctions.js';
import {buildingAt, placeBehaviors} from './layers/places/layer-places.js';
import {greenBehaviors} from './layers/green/layer-green.js';
import {reliefBehaviors} from './layers/relief/layer-relief.js';
import {layerJoints, levelFacts} from './layers/shared/layer-joints.js';
import {roadBehaviors} from './layers/roads/layer-roads.js';
import {isPickableEntry, roadsClickTarget, roadsJointsToShow, roadsPickableEntries} from './layers/roads/roads-host.js';
import {routeBehaviors} from './layers/routes/layer-routes.js';
import {settlementBehaviors} from './layers/settlements/layer-settlements.js';
import {layerForSketch, sketchBehaviors, sketchChoices, sketchFile, sketchRule} from './layers/shared/layer-sketches.js';
import {stopBehaviors} from './layers/stops/layer-stops.js';
import {waterBehaviors} from './layers/water/layer-water.js';
import {featureCapabilities, layerLockReason, validateLayerRules} from './layers/shared/layer-rules.js';
import {renderFeatureCounts, renderLayerChoices, renderSourceTable, showActiveLayer} from './layers/shared/layers-panel.js';
import {isMagnetOn} from './map-tools/magnet-switch.js';
import {hideModeBar, showModeBar} from './map-tools/mode-bar.js';
import {writeNote} from './inspector/note-dialog.js';
import {ObjectList} from './map-tools/object-list.js';
import {startOfflineCopy} from './offline/offline-install.js';
import {ReviewPanel} from './editing/review-panel.js';
import {loadSourceBundle} from './source-data/source-bundle.js';
import {createSourceOverlay, guideMinZoom, overlayCollection, sourceEntriesForHits} from './source-data/source-overlay.js';
import {showLevelPicker} from './layers/roads/level-picker.js';
import {hideToast, showToast} from './map-tools/toast.js';
import {WorkingMap} from './map-tools/working-map.js';
import {
  hideInspector,
  inspectorHasFocus,
  installWorkspace,
  setPanelOpener,
  showInspector,
  showPanel
} from './app/workspace-panels.js';

registerBehaviors(buildingBehaviors);
registerBehaviors(addressBehaviors);
registerBehaviors(placeBehaviors);
registerBehaviors(roadBehaviors);
registerBehaviors(greenBehaviors);
registerBehaviors(waterBehaviors);
registerBehaviors(reliefBehaviors);
registerBehaviors(settlementBehaviors);
registerBehaviors(stopBehaviors);
registerBehaviors(routeBehaviors);
registerBehaviors(sketchBehaviors);
registerBehaviors(junctionBehaviors);
registerBehaviors(gapBehaviors, 'addresses');

const applyOrCancelMessage = 'Apply or Cancel the current edit first.';
// The width at which the workspace becomes the phone one, as in style.css.
const phoneLayout = matchMedia('(max-width: 720px)');
let map;
let sources;
let overlay;
let jointLayer;
let shownLevel = null;
let workingMap;
let layers = [];
let activeLayer = null;
let activeEntries = [];
let areGuidesVisible = true;
let isSatelliteVisible = false;
let isLayerLoading = false;
let isSourceLoading = false;
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
let pendingSourceLoad = null;
let activeFilter = null;
let pendingSelection = null;
let resolvingItem = null;
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

// Kinds that only follow from other objects, and files another layer edits, are drawn and never picked.
const isPickable = entry => isPickableEntry(entry, activeLayer);

// The working objects of a file, or none when the bundle does not have it.
const entriesOf = filename => (sources.has(filename) ? session.workingEntries(filename) : []);

// What a layer's behavior may read, never a way around the commands.
function behaviorContext() {
  return createBehaviorContext({
    session,
    rules,
    levels,
    map,
    layer: activeLayer,
    isPhone: () => phoneLayout.matches,
    isMagnetOn,
    entriesOf,
    // The one level of the road graph that is shown, or null for all.
    shownLevel: () => shownLevel,
    select: entry => selectObject(entry, true),
    startNew: startNewFeature,
    pick: pickObject,
    pickPoint,
    saveSketch,
    showPath: (coordinates, colour) => overlay.setPath(coordinates, colour),
    showNextGap
  });
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

// What stands for several objects, such as a junction, has no source of its own.
function showIdentity({filename, key}) {
  const hash = sources.get(filename)?.metadata.sha256;
  elementById('selection-source').textContent = hash ? `${filename} · feature ${key}` : '';
  elementById('identity').textContent = hash ? `Pinned source SHA-256: ${hash}. Feature indices are revision-bound.` : '';
}

// Objects are selected from full source geometry, never clipped tile coordinates. Upstream IDs are
// shown here because overlay features use the array index as their ID instead.
function showFeature(entry) {
  const {filename, key, feature} = entry;
  editing.close();
  showInspector();
  const behavior = behaviorOf(filename, activeLayer.id);
  setHeading(behavior.kind(feature), behavior.title(feature, behaviorContext()));
  showIdentity(entry);
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
  cancelPick();
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
  if (!activeLayer) return [];
  const isLimited = phoneLayout.matches && activeLayer.phoneFiles;
  return [...(isLimited ? activeLayer.phoneFiles : activeLayer.files), ...activeLayer.contextFiles];
};

function withDerivedFacts(entry) {
  const {feature} = entry;
  return {...feature, properties: {...feature.properties, ...derivedFacts(entry, entriesOf)}};
}

// The active layer's files and every changed file use the public cartography with their working features. The others
// stay as released, for context.
function workingFeatures(displayFeatures) {
  const featuresByFile = new Map();
  for (const filename of shownFiles()) {
    featuresByFile.set(filename, displayFeatures.filter(({properties}) => properties.sourceFile === filename));
  }
  for (const filename of session.changedFiles()) {
    if (featuresByFile.has(filename)) continue;
    featuresByFile.set(filename, session.workingEntries(filename).map(withDerivedFacts));
  }
  return featuresByFile;
}

function changedFeaturesOf(filename) {
  return session.changes(filename).map(({after}) => after).filter(feature => feature?.geometry);
}

// Sketches with their outline, notes with a pin where they were left.
function sketchFeatures() {
  return session.fieldItems().flatMap(({type, geometry}) => {
    if (type === 'deletion' || !geometry) return [];
    const pin = {type: 'Feature', properties: {type}, geometry: {type: 'Point', coordinates: centreOf(geometry)}};
    return type === 'sketch' ? [{type: 'Feature', properties: {type}, geometry}, pin] : [pin];
  });
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
  activeEntries = activeFilter
    ? activeFilter.entries(behaviorContext())
    : shownFiles().flatMap(filename => session.workingEntries(filename));
  const changedFeatures = new Set(session.changedFiles().flatMap(changedFeaturesOf));
  const stateOf = entry => {
    if (activeFilter) return activeFilter.state;
    if (!isPickable(entry)) return 'context';
    return changedFeatures.has(entry.feature) ? 'applied' : 'editable';
  };
  const factsOf = entry => ({...levelFacts(entry), ...derivedFacts(entry, entriesOf)});
  const collection = overlayCollection(activeEntries, stateOf, factsOf);
  overlay.setData(collection);
  overlay.setInteriorsPickable(Boolean(activeFilter));
  const otherChangedFiles = session.changedFiles().filter(filename => !shownFiles().includes(filename));
  overlay.setApplied(otherChangedFiles.flatMap(changedFeaturesOf));
  overlay.setDeletions(markedFeatures());
  overlay.setSketches(sketchFeatures());
  overlay.setGuideMinZoom(activeLayer?.guideMinZoom ?? guideMinZoom, activeLayer?.pointGuideMinZoom);
  try {
    workingMap.show(workingFeatures(collection.features), new Set(shownFiles()));
  } catch (error) {
    showError(new Error(`Drawing the changes failed: ${error.message}`));
  }
  renderLevels();
  renderJoints();
}

// Where lines of the layer join, end or only touch, in the view. On one level, only its own.
function renderJoints() {
  if (activeFilter) {
    jointLayer.show([]);
    return;
  }
  jointLayer.show(
    roadsJointsToShow({
      layer: activeLayer,
      bounds: viewBounds(),
      context: behaviorContext(),
      shownLevel,
      zoom: map.getZoom()
    })
  );
}

// The levels in the view, and always the shown one, so that it can be left.
function renderLevelPicker() {
  const levelsOfLayer = layerJoints[activeLayer?.id]?.levels;
  const isShown = levelsOfLayer && !activeFilter && map.getZoom() >= jointMinZoom;
  const viewLevels = isShown ? levelsOfLayer(viewBounds(), behaviorContext()) : [];
  const shownLevels = shownLevel === null ? [] : [shownLevel];
  showLevelPicker([...new Set([...viewLevels, ...shownLevels])], shownLevel, showLevel);
}

function renderLevels() {
  overlay.setShownLevel(shownLevel);
  workingMap.setShownLevel(shownLevel);
  renderLevelPicker();
}

function renderView() {
  renderLevelPicker();
  renderJoints();
}

const viewBounds = () => {
  const bounds = map.getBounds();
  return [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
};

function showLevel(level) {
  shownLevel = level;
  renderLevels();
  renderJoints();
}

// Toggling presentation preserves the open edit; clicks wait until the new visibility has rendered.
function toggleGuides() {
  areGuidesVisible = !areGuidesVisible;
  clickCandidates = null;
  overlay.setGuidesVisible(areGuidesVisible);
  elementById('edit-guides').setAttribute('aria-pressed', String(areGuidesVisible));
  if (!isSourceLoading) setStatus(layerStatus());
  deferInteractionUntilRender();
}

// A source worker signals content before the next paint. The visible status follows that signal, while clicks, the
// object list and selection keep waiting for the rendered layer, which a slow device may paint much later.
function showLoadingStatus() {
  isLayerLoading = activeLayer !== null;
  isSourceLoading = isLayerLoading;
  if (isLayerLoading) {
    setStatus(`Loading ${activeLayer.name}…`, true);
    watchSourceLoad('editor-source');
  } else {
    stopWatchingSourceLoad();
    setStatus(layerStatus());
  }
  renderObjectList();
}

// A presentation change has no new source content, so only its rendered state gates further interaction.
function deferInteractionUntilRender() {
  if (!activeLayer) return;
  isLayerLoading = true;
  renderObjectList();
}

function watchSourceLoad(sourceId) {
  stopWatchingSourceLoad();
  const source = map.getSource(sourceId);
  if (!source || map.isSourceLoaded(sourceId)) return finishSourceLoading();
  const handler = event => {
    if (event.sourceDataType !== 'content') return;
    finishSourceLoading();
  };
  pendingSourceLoad = {source, handler};
  source.on('data', handler);
}

function stopWatchingSourceLoad() {
  if (!pendingSourceLoad) return;
  pendingSourceLoad.source.off('data', pendingSourceLoad.handler);
  pendingSourceLoad = null;
}

function finishSourceLoading() {
  if (!isSourceLoading) return;
  stopWatchingSourceLoad();
  isSourceLoading = false;
  setStatus(layerStatus());
}

function finishLayerLoading() {
  isLayerLoading = false;
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
  // A sketch belongs to no layer, so it can be made at any time.
  for (const button of elementById('sketch-choices').children) button.disabled = editing.hasUnappliedEdit;
  // Updating reloads the page, which would lose an edit not applied yet, or applied edits that could not be saved.
  elementById('update-app').disabled = editing.hasUnappliedEdit || drafts.hasOnlyInMemoryChanges();
  elementById('update-hint').hidden = !session.hasChanges();
  renderChangeCount();
  review.render();
}

function drawButton(choice) {
  const button = createElementWithText('button', choice.label);
  button.type = 'button';
  button.onclick = () => startNewFeature(choice);
  return button;
}

function renderTools() {
  elementById('edit-guides').hidden = !activeLayer;
  elementById('edit-guides-hint').hidden = !activeLayer;
  const choices = drawChoicesOf(activeLayer, rules).filter(({isDesktopOnly}) => !isDesktopOnly || !phoneLayout.matches);
  const buttons = choices.map(drawButton);
  const filterButtons = (layerFilters[activeLayer?.id] ?? []).map(filter => {
    const button = createElementWithText('button', filter.label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(activeFilter?.id === filter.id));
    button.onclick = () => toggleFilter(filter);
    return button;
  });
  elementById('draw-choices').replaceChildren(...buttons, ...filterButtons);
  const sketchButtons = sketchChoices.map(drawButton);
  elementById('sketch-choices').replaceChildren(...sketchButtons);
  showResolving();
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
function showApplied(message, entry = null) {
  const resolvedItem = itemResolvedBy(entry, message);
  if (resolvedItem) {
    session.removeFieldItem(resolvedItem.id);
    stopResolving();
  }
  showSessionChange();
  const restoreItem = () => {
    if (resolvedItem) session.saveFieldItem(resolvedItem);
  };
  if (message) {
    const undo = () => travelHistory(commands.undo, restoreItem);
    showToast(resolvedItem ? `${message} · resolved` : message, {action: undo});
  } else if (resolvedItem) {
    showToast('Note resolved', {action: () => whenNoEditIsOpen(restoreItem)});
  }
}

// Whether the open edit finishes the chosen field item: it changes the object the item names, or on the layer of a sketch
// it is the new object drawn over it.
function isResolving({filename, key, feature, isNew}) {
  if (!resolvingItem || filename === sketchFile || activeLayer?.id !== resolvingItem.layer) return false;
  const {target} = resolvingItem;
  if (!target) return isNew;
  return filename === target.filename && isReferencedObject({key, feature}, target.reference);
}

// A note can be settled by finding nothing to change. A sketch or a mark needs what it asks for.
function itemResolvedBy(entry, message) {
  const isDone = message !== null || resolvingItem?.type === 'note';
  return isDone && entry && isResolving(entry) ? resolvingItem : null;
}

// Redrawing closes the inspector, so a typed edit waits for its own decision first.
function whenNoEditIsOpen(change) {
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return;
  }
  change();
  showSessionChange();
}

function travelHistory(travel, afterTravel = () => {}) {
  if (!activeLayer) return;
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return;
  }
  if (travel() === null) return;
  afterTravel();
  showSessionChange();
}

// Field items have no history of their own, so each change of them carries its way back.
function changeFieldItems(change, message, undoChange) {
  change();
  showSessionChange();
  showToast(message, {action: () => whenNoEditIsOpen(undoChange)});
}

function markForDeletion(entry, name) {
  const item = newDeletionMark(entry, name, activeLayer.id);
  changeFieldItems(
    () => session.saveFieldItem(item),
    'Marked for deletion',
    () => session.removeFieldItem(item.id)
  );
}

function saveSketch(sketch) {
  // Something of another kind is finished where it was drawn, if anything can be drawn there.
  const canDrawHere = drawChoicesOf(activeLayer, rules).length > 0;
  const layerId = layerForSketch(sketch.what, canDrawHere ? activeLayer.id : 'places');
  const item = {...sketch, layer: layerId};
  changeFieldItems(
    () => session.saveFieldItem(item),
    'Sketch saved',
    () => session.removeFieldItem(item.id)
  );
}

function leaveNote(entry, name) {
  writeNote(name, note => {
    const item = newNote(entry, name, activeLayer.id, note);
    // The object stays open, with whatever is typed in its form.
    const changeNote = change => {
      change();
      drafts.persist();
      overlay.setSketches(sketchFeatures());
      renderCommandAvailability();
    };
    changeNote(() => session.saveFieldItem(item));
    showToast('Note saved', {action: () => changeNote(() => session.removeFieldItem(item.id))});
  });
}

function dismissFieldItem(item) {
  if (resolvingItem?.id === item.id) stopResolving();
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

// What is being finished stays in sight until it is resolved or put back.
function showResolving() {
  elementById('resolve-bar').hidden = !resolvingItem;
  if (!resolvingItem) return;
  const {title, detail} = fieldItemLabel(resolvingItem);
  elementById('resolve-title').textContent = `From the field: ${title}`;
  elementById('resolve-detail').textContent = detail;
  const choices = resolvingItem.type === 'sketch' ? drawChoicesOf(activeLayer, rules) : [];
  const buttons = choices.map(drawButton);
  elementById('resolve-choices').replaceChildren(...buttons);
}

function stopResolving() {
  resolvingItem = null;
  showResolving();
}

// The desk goes to the object on its own layer, over satellite imagery, where it decides.
function openFieldItem(item) {
  const layer = layers.find(({id}) => id === item.layer);
  if (!layer) {
    showToast('This snapshot has no such layer.');
    return;
  }
  if (layer.id !== activeLayer?.id && !setLayer(layer)) return;
  // A filter hides the objects of the layer, and the item names one of them.
  if (activeFilter) toggleFilter(activeFilter);
  resolvingItem = item;
  showResolving();
  showPanel(null);
  showSatellite(true);
  if (item.geometry) map.jumpTo({center: centreOf(item.geometry), zoom: Math.max(map.getZoom(), guideMinZoom + 1)});
  const entry = item.target && activeEntries.find(candidate =>
    candidate.filename === item.target.filename && isReferencedObject(candidate, item.target.reference)
  );
  if (entry) selectWhenReady(entry);
  else if (item.target) showToast(`${item.target.name} is no longer on this layer.`);
}

// New objects get a local identity and no upstream claims, which is what the importer requires of them.
function startNewFeature({label, filename, shape, properties, geometry}) {
  clearSelection();
  showPanel(null);
  const localId = `local:${crypto.randomUUID()}`;
  const fields = newFeatureFields(filename, localId, rules);
  setHeading('New', label);
  elementById('selection-source').textContent = filename === sketchFile ? '' : `${filename} · new feature`;
  if (geometry || shape === 'None') showInspector();
  editing.openNew(filename, localId, shape, {...fields, geometry, properties: {...fields.properties, ...properties}});
}

// Exactly one layer is active, or none. The map keeps its position and zoom.
function setLayer(layer) {
  if (editing.hasUnappliedEdit) {
    pendingLayer = {layer};
    elementById('layer-switch-dialog').showModal();
    return false;
  }
  cancelPick();
  editing.close();
  hideToast();
  activeFilter = null;
  pendingSelection = null;
  stopResolving();
  activeLayer = activeLayer?.id === layer?.id ? null : layer;
  shownLevel = null;
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
  const pickable = activeEntries.filter(isPickable);
  const hasOnlyRecords = pickable.length > 0 && pickable.every(({feature}) => !feature.geometry);
  if (!hasOnlyRecords) return;
  // Lines have no place of their own on the map, so they are picked from their list.
  showPanel('objects-panel', elementById('open-objects'));
  renderObjectList();
}

// Only visible guides or normal cartography supply candidates, both for clicks and the keyboard list.
function selectableLayerIds() {
  if (activeFilter) return [overlay.interiorLayerId, ...overlay.layerIds];
  return [...workingMap.layerIds, ...overlay.inspectionLayerIds, ...(areGuidesVisible ? overlay.layerIds : [])];
}

const pickableEntries = hits =>
  roadsPickableEntries({hits, entries: activeEntries, layer: activeLayer, shownLevel});

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
  const unplacedEntries = activeEntries.filter(entry => !entry.feature.geometry && isPickable(entry));
  objectList.render(clickCandidates ?? [...pickableEntries(hits), ...unplacedEntries], heading, '');
}

// Returns whether selection succeeded, preserving unrelated panels and any unfinished edit.
function selectObject(entry, shouldFocus = false) {
  if (!activeLayer || isLayerLoading) return false;
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return false;
  }
  const feature = featureForEntry(entry, session);
  if (!feature) return false;
  showFeature({...entry, feature});
  if (shouldFocus) elementById('close-inspector').focus();
  return true;
}

// Asks for one object of a file on the map. Gives its entry, or null when someone cancels or leaves the layer.
function pickObject(filename, prompt, cancelLabel = 'Cancel') {
  hideInspector();
  return new Promise(resolve => {
    pendingPick = {filename, resolve};
    const cancel = {id: 'mode-cancel', label: cancelLabel, run: () => finishPick(null)};
    showModeBar({title: prompt, hint: 'Tap it on the map', buttons: [cancel]});
  });
}

// What the layer shows there, or a shape of another file that contains the tap.
function entryUnderPick(event) {
  const {filename} = pendingPick;
  if (filename === null) {
    return {feature: {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: event.lngLat.toArray()}}};
  }
  const hits = sourceEntriesForHits(hitTest(map, event.point, selectableLayerIds()), activeEntries);
  const shown = hits.find(entry => entry.filename === filename);
  if (shown || filename !== 'buildings.geojson') return shown;
  return buildingAt(event.lngLat.toArray(), behaviorContext());
}

// Asks for a place on the map. Gives its coordinate, or null when someone cancels.
async function pickPoint(prompt) {
  const picked = await pickObject(null, prompt);
  return picked?.feature.geometry.coordinates ?? null;
}

// Whoever asked gets no object, so the question does not outlive the edit that asked it. Returns whether one was open.
function cancelPick() {
  if (!pendingPick) return false;
  finishPick(null);
  return true;
}

function finishPick(entry) {
  const {resolve} = pendingPick;
  pendingPick = null;
  hideModeBar();
  // Whatever the edit does with the answer, its refusals and its buttons are in the inspector.
  showInspector();
  resolve(entry);
}

// Clicks wait for the layer to finish loading, and a hit from another file never selects anything.
function selectFeatureAtClick(event) {
  if (editing.hasGeometryTool && !isLayerLoading && !pendingPick) {
    editing.tap(event);
    return;
  }
  if (!activeLayer || isLayerLoading) return;
  if (pendingPick) {
    const picked = entryUnderPick(event);
    if (picked) finishPick(picked);
    return;
  }
  // A stray tap must not silently throw away typed details.
  if (editing.hasUnappliedEdit) {
    setStatus(applyOrCancelMessage, true);
    return;
  }
  const target = roadsClickTarget({
    point: event.point,
    jointLayer,
    layer: activeLayer,
    context: behaviorContext(),
    entries: activeEntries,
    shownLevel,
    hitsOf: () => hitTest(map, event.point, selectableLayerIds())
  });
  if (target.entry) {
    selectObject(target.entry);
    return;
  }
  const candidates = target.candidates;
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
    showMarks: marks => jointLayer.showMarks(marks),
    onRecorded: showApplied,
    onClosed: clearSelection,
    onMarkedForDeletion: markForDeletion,
    onNoteWanted: leaveNote,
    isResolving,
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

function showSatellite(isVisible) {
  isSatelliteVisible = isVisible;
  setSatelliteVisible(map, isVisible);
  elementById('satellite').setAttribute('aria-pressed', String(isVisible));
}

function toggleSatellite() {
  showSatellite(!isSatelliteVisible);
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
    leaveMode: () => cancelPick() || Boolean(editing?.leaveModeOnEscape())
  });
  installLayerSwitchDialog();
  installInspectorViewport();
}

// Software WebGL spends seconds compiling and rasterising shaders, which delays every map move. Draw at quarter scale
// there so an edit still appears at once; a hardware renderer keeps its normal resolution.
function softwareRendererPixelRatio() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  const info = context?.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(context.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  context?.getExtension('WEBGL_lose_context')?.loseContext();
  return /swiftshader|llvmpipe|software/i.test(renderer) ? 0.25 : null;
}

async function createEditorMap(mapMetadata) {
  if (!archiveFilenamePattern.test(mapMetadata.archive)) throw new Error('Invalid map archive metadata.');
  registerArchiveProtocol(maplibregl, pmtiles);
  const basemapURL = 'pmtiles://' + new URL(`data/${mapMetadata.archive}`, location.href).href;
  const pixelRatio = softwareRendererPixelRatio();
  map = createMap({engine: maplibregl, container: 'map', basemapURL, assetBaseURL: location.href});
  if (pixelRatio) map.setPixelRatio(pixelRatio);
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
    visibilityConfig: placeVisibility,
    publishedPlaces,
    sharedSource: 'editor-source'
  });
  overlay = createSourceOverlay(map);
  jointLayer = createJointLayer(map);
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
  map.on('moveend', renderView);
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
  elementById('resolve-close').onclick = stopResolving;
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
  rules = {...rules, layers: {...rules.layers, [sketchFile]: sketchRule}};
  rules = {...rules, layers: {...rules.layers, [junctionFile]: junctionRule}};
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
