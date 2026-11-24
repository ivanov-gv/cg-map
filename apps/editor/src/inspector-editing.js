import {createElementWithText, elementById} from './dom.js';
import {confirmDeletion} from './deletion-dialog.js';
import {installDragGestures} from './drag-gestures.js';
import {drawingHint, drawingMeasure} from './drawing-hints.js';
import {
  afterDrawnPoint,
  afterGestureMove,
  afterMapTap,
  afterUndoneDrawnPoint,
  beginExistingEdit,
  beginGesture,
  beginNewLine,
  beginNewPoint,
  beginNewPolygon,
  canFinishDrawing,
  cancelGesture,
  editTools,
  endGesture,
  finishDrawing,
  isDrawing,
  withGeometry,
  withTool,
  withTypedDetails
} from './edit-transaction.js';
import {removeVertex} from './geometry-editing.js';
import {rightAngledCorner} from './geometry-measures.js';
import {behaviorOf} from './layer-behaviors.js';
import {featureCapabilities, featureProblem} from './layer-rules.js';
import {hideModeBar, setCrossVisible, showModeBar} from './mode-bar.js';
import {formValues, propertiesFromForm, renderPropertyForm} from './property-form.js';

// How close to the first corner, on screen, a tap closes a shape.
const closingDistancePixels = 14;

const beginNewByShape = {Point: beginNewPoint, LineString: beginNewLine, Polygon: beginNewPolygon};

// Owns the pending edit in the inspector: its form, geometry tools and the Apply or Cancel decision.
// context: {commands, session, rules, levels, handles, overlay, map, activeLayer(), isPhone(), behaviorContext(),
// onRecorded(message), onClosed(), onMarkedForDeletion(entry, name), showInspector(), hideInspector(),
// releaseInspectorFocus(), focusStatus(), onEditStateChanged()}. releaseInspectorFocus parks focus outside the inspector
// and returns whether the inspector held focus, so the status is focused only when it was needed.
export class InspectorEditing {
  #context;
  #transaction = null;
  #filename = null;
  #pointer = null;

  constructor(context) {
    this.#context = context;
  }

  get #rule() {
    return this.#context.rules.layers[this.#filename];
  }

  get #behavior() {
    return behaviorOf(this.#filename);
  }

  get #isVertexTool() {
    return this.#transaction?.tool === editTools.vertices;
  }

  get #isPlacing() {
    return this.#transaction?.tool === editTools.placePoint;
  }

  get #baseFeature() {
    return this.#context.session.baseFeature(this.#filename, this.#transaction.key);
  }

  showProblem(message) {
    elementById('edit-problem').textContent = message ?? '';
    elementById('edit-problem').hidden = !message;
  }

  // Where the next drawn point would go: under the fixed cross on a phone, under the pointer at the desk.
  #nextDrawnPoint() {
    if (this.#context.isPhone()) return this.#context.map.getCenter().toArray();
    return this.#pointer;
  }

  #renderGeometry() {
    const {overlay, handles} = this.#context;
    const {feature, drawnPoints, selectedHandle} = this.#transaction;
    const {geometry} = feature;
    const canDrawSelection = geometry && geometry.coordinates.length > 0;
    overlay.setSelection(canDrawSelection ? feature : null);
    overlay.setDrawing(drawnPoints, isDrawing(this.#transaction) ? this.#nextDrawnPoint() : null);
    const original = this.#context.session.workingFeature(this.#filename, this.#transaction.key);
    const isReshaped = original && JSON.stringify(original.geometry) !== JSON.stringify(geometry);
    overlay.setGhost(isReshaped ? original.geometry : null);
    if (isDrawing(this.#transaction)) handles.showPoints(drawnPoints);
    else if (this.#isVertexTool) handles.show(geometry, selectedHandle);
    else handles.clear();
  }

  #drawingButtons() {
    const isPhone = this.#context.isPhone();
    const {drawnPoints} = this.#transaction;
    const pointWord = this.#transaction.tool === editTools.drawLine ? 'point' : 'corner';
    const addButton = {
      id: 'mode-add',
      label: `Add ${pointWord}`,
      isPrimary: true,
      run: () => this.#addDrawnPoint(this.#context.map.getCenter().toArray())
    };
    return [
      {
        id: 'mode-undo',
        label: isPhone ? 'Undo' : `Undo ${pointWord}`,
        isDisabled: drawnPoints.length === 0,
        run: () => this.#update(afterUndoneDrawnPoint(this.#transaction))
      },
      ...(isPhone ? [addButton] : []),
      {
        id: 'mode-done',
        label: 'Finish',
        isDisabled: !canFinishDrawing(this.#transaction),
        run: () => this.#finishDrawing()
      },
      {id: 'mode-cancel', label: 'Cancel', run: () => this.#cancelMode()}
    ];
  }

  #placingButtons() {
    const placeHere = {
      id: 'mode-add',
      label: 'Place it here',
      isPrimary: true,
      run: () => this.#placeUnderCross()
    };
    const cancel = {id: 'mode-cancel', label: 'Cancel', run: () => this.discardEdit()};
    return this.#context.isPhone() ? [placeHere, cancel] : [cancel];
  }

  #reshapingButtons() {
    const done = {id: 'mode-done', label: 'Done', isPrimary: true, run: () => this.leaveMode()};
    if (!this.#isVertexTool) return [done];
    const remove = {
      id: 'vertex-remove',
      label: 'Remove point',
      isDisabled: !this.#transaction.selectedHandle,
      run: () => this.#removeSelectedVertex()
    };
    return [remove, done];
  }

  #renderModeBar() {
    const transaction = this.#transaction;
    setCrossVisible(this.#context.isPhone() && (isDrawing(transaction) || this.#isPlacing));
    if (!transaction.tool) {
      hideModeBar();
      return;
    }
    const isPhone = this.#context.isPhone();
    const title = this.#behavior.title(transaction.feature, this.#context.behaviorContext());
    const measure = drawingMeasure(transaction, this.#nextDrawnPoint());
    const hint = [drawingHint(transaction.tool, isPhone), measure].filter(Boolean).join(' · ');
    let buttons = this.#reshapingButtons();
    if (this.#isPlacing) buttons = this.#placingButtons();
    else if (isDrawing(transaction)) buttons = this.#drawingButtons();
    showModeBar({title: transaction.isNew ? elementById('selection-title').textContent : title, hint, buttons});
  }

  #renderToolButtons() {
    const {isNew, feature} = this.#transaction;
    const geometryType = feature.geometry?.type;
    const isShape = Boolean(geometryType) && geometryType !== 'Point';
    const {canReshape, canDelete} = featureCapabilities(feature, this.#rule);
    const canEditShape = (isNew || canReshape) && Boolean(geometryType);
    elementById('tool-move').hidden = !canEditShape;
    elementById('tool-vertices').hidden = !canEditShape || !isShape;
    elementById('tool-vertices').textContent = geometryType === 'LineString' ? 'Edit points' : 'Edit corners';
    elementById('delete-feature').hidden = isNew || !canDelete;
    const isPhone = this.#context.isPhone();
    elementById('delete-feature').textContent = isPhone ? 'Mark for deletion' : 'Delete';
    const tools = this.#behavior.tools(feature, this.#editContext());
    const shownTools = tools.filter(({isDesktopOnly}) => !isDesktopOnly || !isPhone);
    elementById('extra-tools').replaceChildren(
      ...shownTools.map(({label, run}) => {
        const button = createElementWithText('button', label);
        button.type = 'button';
        button.onclick = run;
        return button;
      })
    );
  }

  #renderFacts() {
    const facts = this.#behavior.measures(this.#transaction.feature, this.#baseFeature);
    elementById('edit-facts').replaceChildren(...facts.map(fact => createElementWithText('p', fact)));
  }

  // What a layer's own controls need: the pending feature, and ways to change it inside this edit.
  #editContext() {
    return {
      feature: this.#transaction.feature,
      key: this.#transaction.key,
      filename: this.#filename,
      isNew: this.#transaction.isNew,
      context: this.#context.behaviorContext(),
      setProperties: properties => this.#setProperties(properties),
      setGeometry: geometry => this.#update(withGeometry(this.#transaction, geometry)),
      startTool: tool => this.#startTool(tool),
      hasUnappliedEdit: () => this.hasUnappliedEdit,
      showProblem: message => this.showProblem(message),
      applyWith: edits => this.#applyWith(edits)
    };
  }

  #setProperties(properties) {
    const feature = {...this.#currentFeature(), properties: {...this.#currentFeature().properties, ...properties}};
    for (const [name, value] of Object.entries(properties)) {
      if (value === undefined) delete feature.properties[name];
    }
    this.#transaction = {...withTypedDetails(this.#transaction), feature};
    this.#renderForm();
    this.#update(this.#transaction);
  }

  #renderForm() {
    const {levels} = this.#context;
    const {feature} = this.#transaction;
    const sections = this.#behavior.sections(feature, this.#editContext());
    renderPropertyForm(elementById('property-form'), feature.properties, this.#rule.properties, levels, sections);
    const extras = elementById('inspector-extras');
    extras.replaceChildren();
    this.#behavior.renderExtras(extras, this.#editContext());
  }

  #update(transaction) {
    this.#transaction = transaction;
    this.showProblem(null);
    elementById('editor').hidden = false;
    elementById('edit-actions').hidden = false;
    this.#renderToolButtons();
    this.#renderFacts();
    this.#renderGeometry();
    this.#renderModeBar();
    this.#context.onEditStateChanged();
  }

  #open(filename, transaction) {
    this.#filename = filename;
    this.#transaction = transaction;
    this.#renderForm();
    this.#update(transaction);
    if (transaction.tool) this.#context.hideInspector();
  }

  openExisting({filename, key, feature}) {
    this.#open(filename, beginExistingEdit(key, feature));
  }

  // fields are {properties, id, geometry}. With a geometry the object already has its place, so its form opens at once.
  openNew(filename, key, shape, {properties, id, geometry}) {
    const transaction = beginNewByShape[shape](key, properties);
    const feature = {...transaction.feature, ...(id ? {id} : {})};
    const placed = geometry ? withTool({...transaction, feature: {...feature, geometry}}, null) : {...transaction, feature};
    this.#open(filename, placed);
  }

  close() {
    this.#transaction = null;
    this.#filename = null;
    this.showProblem(null);
    elementById('editor').hidden = true;
    elementById('edit-actions').hidden = true;
    hideModeBar();
    setCrossVisible(false);
    const {handles, overlay} = this.#context;
    handles.clear();
    overlay.setSelection(null);
    overlay.setGhost(null);
    overlay.setDrawing([], null);
    this.#context.onEditStateChanged();
  }

  // The pending feature with the typed details in it.
  #currentFeature() {
    const {feature} = this.#transaction;
    const values = formValues(elementById('property-form'));
    return {...feature, properties: propertiesFromForm(feature.properties, values, this.#rule.properties)};
  }

  // The result of Apply, or a message explaining why it cannot be recorded yet.
  #validatedFeature() {
    const needsGeometry = !this.#rule.geometries.includes('None') && this.#rule.geometries.length > 0;
    if (needsGeometry && !this.#transaction.feature.geometry) {
      return {problem: 'Tap the map to set the position first.'};
    }
    const behaviorContext = this.#context.behaviorContext();
    const feature = this.#behavior.prepared(this.#currentFeature(), behaviorContext, this.#editContext());
    const ruleProblem = featureProblem(feature, this.#rule, this.#context.levels, this.#baseFeature);
    const edit = {filename: this.#filename, key: this.#transaction.key, feature, before: this.#workingBefore()};
    return {feature, problem: ruleProblem ?? this.#behavior.problem(edit, behaviorContext)};
  }

  #workingBefore() {
    return this.#context.session.workingFeature(this.#filename, this.#transaction.key);
  }

  // Release focus before hiding the inspector; focus the status only after its text has been updated.
  #finishEdit(afterClose) {
    const hadInspectorFocus = this.#context.releaseInspectorFocus();
    this.close();
    afterClose();
    if (hadInspectorFocus) this.#context.focusStatus();
  }

  // Try to commit the current edit. Returns {success: true} or {success: false, problem}.
  applyEdit() {
    return this.#applyWith([]);
  }

  // Records the edit together with others of the same step.
  #applyWith(extraEdits) {
    if (isDrawing(this.#transaction)) return this.#refuse('Finish drawing first.');
    const {feature, problem} = this.#validatedFeature();
    if (problem) return this.#refuse(problem);
    const edit = {filename: this.#filename, key: this.#transaction.key, feature, before: this.#workingBefore()};
    const behaviorContext = this.#context.behaviorContext();
    const companions = this.#behavior.companionEdits(edit, behaviorContext);
    const edits = [{filename: this.#filename, key: edit.key, after: feature}, ...companions, ...extraEdits];
    const title = this.#behavior.title(feature, behaviorContext);
    const isRecorded = this.#context.commands.recordEdits(edits);
    this.#finishEdit(() => this.#context.onRecorded(isRecorded ? `Applied · ${title}` : null));
    return {success: true};
  }

  #refuse(problem) {
    this.leaveMode();
    this.showProblem(problem);
    return {success: false, problem};
  }

  // Discard the current edit without recording it.
  discardEdit() {
    this.#finishEdit(() => this.#context.onClosed());
  }

  #recordDeletion(edits, title) {
    this.#context.commands.recordEdits(edits);
    this.#finishEdit(() => this.#context.onRecorded(`Deleted · ${title}`));
  }

  // On a phone an object is only marked; the desk confirms it. An object added here can be dropped at once.
  #deleteFeature() {
    const entry = {filename: this.#filename, key: this.#transaction.key, feature: this.#workingBefore()};
    const behaviorContext = this.#context.behaviorContext();
    const title = this.#behavior.title(entry.feature, behaviorContext);
    const isOnlyMarked = this.#context.isPhone() && this.#baseFeature !== null;
    if (isOnlyMarked) {
      this.#finishEdit(() => this.#context.onMarkedForDeletion(entry, title));
      return;
    }
    const {message, edits, options = []} = this.#behavior.deletion(entry, behaviorContext);
    const ownEdit = {filename: entry.filename, key: entry.key, after: null};
    confirmDeletion({title: `Delete ${title}?`, message, options}, async option => {
      const optionEdits = option?.resolve ? await option.resolve() : (option?.edits ?? []);
      if (optionEdits) this.#recordDeletion([ownEdit, ...edits, ...optionEdits], title);
    });
  }

  #removeSelectedVertex() {
    const {selectedHandle, feature} = this.#transaction;
    const geometry = removeVertex(feature.geometry, selectedHandle);
    this.#update({...withGeometry(this.#transaction, geometry), selectedHandle: null});
  }

  #startTool(tool) {
    this.#transaction = {...this.#transaction, feature: this.#currentFeature()};
    this.#update(withTool(this.#transaction, tool));
    this.#context.hideInspector();
  }

  // Back from a mode to the whole inspector, keeping what the mode changed.
  leaveMode() {
    if (!this.#transaction?.tool) return;
    this.#update(withTool(this.#transaction, null));
    this.#context.showInspector();
  }

  // Cancel drops a new object, and only the hole of an existing one.
  #cancelMode() {
    if (this.#transaction.isNew) this.discardEdit();
    else this.leaveMode();
  }

  #finishDrawing() {
    this.#update(finishDrawing(this.#transaction));
    this.#renderForm();
    this.#context.showInspector();
  }

  #addDrawnPoint(coordinate) {
    this.#update(afterDrawnPoint(this.#transaction, coordinate));
  }

  #placeUnderCross() {
    const {map} = this.#context;
    const lngLat = map.getCenter();
    this.#placePoint(this.#snappedPoint({lngLat, point: map.project(lngLat)}) ?? lngLat.toArray());
  }

  #placePoint(coordinate) {
    this.#update(afterMapTap(this.#transaction, coordinate, null));
    this.#renderForm();
    this.#context.showInspector();
  }

  #startGesture(event) {
    if (!this.#transaction) return false;
    const pressedHandle = this.#isVertexTool ? this.#context.handles.handleAt(event.point) : null;
    const next = beginGesture(this.#transaction, event.lngLat.toArray(), pressedHandle);
    if (!next.gesture) return false;
    this.#update(next);
    return true;
  }

  // A dragged point stops where the layer's rules say it must, such as at the next contour line.
  #draggedTransaction(transaction, coordinate) {
    const moved = afterGestureMove(transaction, coordinate);
    const limit = this.#behavior.limitedGeometry;
    if (!limit) return moved;
    const behaviorContext = this.#context.behaviorContext();
    const {feature, key} = transaction;
    const edit = {filename: this.#filename, key, feature, previousGeometry: feature.geometry};
    return withGeometry(moved, limit(moved.feature.geometry, edit, behaviorContext));
  }

  // Each handler checks for a live gesture, because Escape or Cancel can end the edit in the middle of a drag.
  #installGestures() {
    const whileDragging = change => {
      if (this.#transaction?.gesture) this.#update(change(this.#transaction));
    };
    installDragGestures(this.#context.map, {
      onStart: event => this.#startGesture(event),
      onMove: coordinate => whileDragging(transaction => this.#draggedTransaction(transaction, coordinate)),
      onEnd: () => whileDragging(endGesture),
      onCancel: () => whileDragging(cancelGesture)
    });
  }

  // The line to the next point and its length follow the pointer, or the map under the cross.
  #installDrawingPreview() {
    const renderWhileDrawing = () => {
      if (!isDrawing(this.#transaction)) return;
      this.#context.overlay.setDrawing(this.#transaction.drawnPoints, this.#nextDrawnPoint());
      this.#renderModeBar();
    };
    this.#context.map.on('mousemove', event => {
      this.#pointer = this.#drawnCoordinate(event);
      renderWhileDrawing();
    });
    this.#context.map.on('move', () => {
      if (this.#context.isPhone()) renderWhileDrawing();
    });
  }

  registerActions() {
    const onClick = (id, action) => {
      elementById(id).onclick = action;
    };
    onClick('tool-move', () => this.#startTool(editTools.move));
    onClick('tool-vertices', () => this.#startTool(editTools.vertices));
    onClick('cancel-edit', () => this.discardEdit());
    onClick('delete-feature', () => this.#deleteFeature());
    elementById('property-form').oninput = () => this.#update(withTypedDetails(this.#transaction));
    elementById('property-form').onsubmit = event => {
      event.preventDefault();
      this.applyEdit();
    };
    this.#installGestures();
    this.#installDrawingPreview();
  }

  // Escape rolls back only the drag in progress; previous adjustments and typed fields survive.
  cancelActiveGesture() {
    if (!this.#transaction?.gesture) return false;
    this.#update(cancelGesture(this.#transaction));
    return true;
  }

  // Escape ends a move or corner mode. A drawing has its own Cancel, because leaving it would lose the points.
  leaveModeOnEscape() {
    if (!this.#transaction?.tool || isDrawing(this.#transaction) || this.#isPlacing) return false;
    this.leaveMode();
    return true;
  }

  get hasGeometryTool() {
    return Boolean(this.#transaction?.tool);
  }

  get hasUnappliedEdit() {
    return Boolean(this.#transaction?.hasUnappliedEdit);
  }

  get openFilename() {
    return this.#filename;
  }

  #isClosingTap(event) {
    const [firstPoint] = this.#transaction.drawnPoints;
    if (!firstPoint || !canFinishDrawing(this.#transaction)) return false;
    if (this.#transaction.tool === editTools.drawLine) return false;
    return event.point.dist(this.#context.map.project(firstPoint)) <= closingDistancePixels;
  }

  // Where a layer says a point belongs, such as on the outline of a building, or null.
  #snappedPoint(event) {
    return this.#behavior.snappedPoint?.(event, this.#context.behaviorContext(), this.#transaction.feature);
  }

  // Shift keeps right angles while drawing a building or any other shape. A layer can join a tap to what is there.
  #drawnCoordinate(event) {
    const coordinate = event.lngLat.toArray();
    if (!isDrawing(this.#transaction)) return coordinate;
    const {drawnPoints, tool} = this.#transaction;
    if (event.originalEvent?.shiftKey && tool !== editTools.drawLine) return rightAngledCorner(drawnPoints, coordinate);
    return this.#snappedPoint(event) ?? coordinate;
  }

  tap(event) {
    if (this.#isPlacing) {
      this.#placePoint(this.#snappedPoint(event) ?? event.lngLat.toArray());
      return;
    }
    if (this.#isClosingTap(event)) {
      this.#finishDrawing();
      return;
    }
    if (isDrawing(this.#transaction)) {
      // With a fixed cross the finger only moves the map.
      if (!this.#context.isPhone()) this.#addDrawnPoint(this.#drawnCoordinate(event));
      return;
    }
    const handle = this.#isVertexTool ? this.#context.handles.handleAt(event.point) : null;
    // The press that began this tap already added the point, and the handles may not have been drawn again yet.
    if (handle?.isMidpoint) return;
    this.#update(afterMapTap(this.#transaction, event.lngLat.toArray(), handle));
  }

  // A double click ends a line where it is. Its two clicks already added the last point, the second one twice.
  finishWithDoubleClick() {
    if (!isDrawing(this.#transaction)) return false;
    const {drawnPoints} = this.#transaction;
    const isRepeated = drawnPoints.length > 1 && String(drawnPoints.at(-1)) === String(drawnPoints.at(-2));
    if (isRepeated) this.#transaction = afterUndoneDrawnPoint(this.#transaction);
    if (canFinishDrawing(this.#transaction)) this.#finishDrawing();
    return true;
  }
}
