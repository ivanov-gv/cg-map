import {createElementWithText, elementById} from './dom.js';
import {
  areasAround,
  hasOutline,
  magneticallyMoved,
  magneticPoint,
  neighbouringAreas,
  reachMetres
} from './area-magnet.js';
import {doOverlap, overlapNotice} from './area-overlap.js';
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
  beginNewRecord,
  canFinishDrawing,
  cancelGesture,
  editTools,
  endGesture,
  finishDrawing,
  isDrawing,
  withGeometry,
  withoutVertex,
  withReplacedFeature,
  withTool,
  withTypedDetails
} from './edit-transaction.js';
import {DragBudget} from './drag-budget.js';
import {followingEdits} from './following-shapes.js';
import {isMagnetOn, setMagnetOn} from './magnet-switch.js';
import {isSameHandle, moveVertex, vertexHandles} from './geometry-editing.js';
import {rightAngledCorner} from './geometry-measures.js';
import {formControls} from './form-controls.js';
import {behaviorOf} from './layer-behaviors.js';
import {sketchFile} from './layer-sketches.js';
import {featureCapabilities, featureProblem, operationProblem} from './layer-rules.js';
import {hasMagnetEffect} from './magnet-tools.js';
import {hideModeBar, setCrossVisible, showModeBar} from './mode-bar.js';
import {formValues, propertiesFromForm, renderPropertyForm} from './property-form.js';
import {usualValuesOf} from './usual-values.js';

// How close to the first corner, on screen, a tap closes a shape.
const closingDistancePixels = 14;

const beginNewByShape = {
  Point: beginNewPoint,
  LineString: beginNewLine,
  Polygon: beginNewPolygon,
  None: beginNewRecord
};

// Owns the pending edit in the inspector: its form, geometry tools and the Apply or Cancel decision.
// context: {commands, session, rules, levels, handles, overlay, map, isPhone(), behaviorContext(),
// onRecorded(message, entry), onClosed(), onMarkedForDeletion(entry, name), onNoteWanted(entry, name),
// isResolving(entry), showInspector(), hideInspector(),
// releaseInspectorFocus(), focusStatus(), onEditStateChanged()}. releaseInspectorFocus parks focus outside the inspector
// and returns whether the inspector held focus, so the status is focused only when it was needed.
export class InspectorEditing {
  #context;
  #transaction = null;
  #filename = null;
  #pointer = null;
  // The shape of the object when its edit was opened.
  #openedGeometry = null;
  #followingBudget = new DragBudget();
  #followingProblem = null;
  #overlapBudget = new DragBudget();
  #overlapCache = new WeakMap();
  #overlaps = [];
  // Counts the edits opened, to tell one from the next.
  #opening = 0;

  constructor(context) {
    this.#context = context;
  }

  get #rule() {
    return this.#context.rules.layers[this.#filename];
  }

  get #behavior() {
    return behaviorOf(this.#filename, this.#context.behaviorContext().layer?.id);
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

  // What a moved object would belong to where it is now, such as the building a place is dragged over.
  #dragTarget() {
    const {tool, feature} = this.#transaction;
    const isPositioning = tool === editTools.move && feature.geometry;
    return isPositioning ? this.#behavior.dragTarget(feature.geometry, this.#context.behaviorContext()) : null;
  }

  // Where the next drawn point would go: under the fixed cross on a phone, under the pointer at the desk.
  #nextDrawnPoint() {
    const {map} = this.#context;
    if (!this.#context.isPhone()) return this.#pointer;
    const lngLat = map.getCenter();
    return this.#snappedPoint({lngLat, point: map.project(lngLat)}, this.#transaction.drawnPoints) ?? lngLat.toArray();
  }

  // The points of the open line that others share.
  #joinedPoints() {
    const {key, feature} = this.#transaction;
    return this.#behavior.joinedPoints({key, feature}, this.#context.behaviorContext());
  }

  #renderGeometry(nextPoint) {
    const {overlay, handles} = this.#context;
    const {feature, drawnPoints, selectedHandle} = this.#transaction;
    const {geometry} = feature;
    const canDrawSelection = geometry && geometry.coordinates.length > 0;
    overlay.setSelection(canDrawSelection ? feature : null);
    overlay.setDrawing(drawnPoints, isDrawing(this.#transaction) ? nextPoint : null);
    this.#renderFollowing();
    this.#renderOverlaps();
    overlay.setTarget(this.#dragTarget()?.feature ?? null);
    this.#context.showMarks(this.#isVertexTool || isDrawing(this.#transaction) ? [] : this.#behavior.marks(feature));
    if (isDrawing(this.#transaction)) handles.showPoints(drawnPoints);
    else if (this.#isVertexTool) handles.show(geometry, selectedHandle, this.#joinedPoints());
    else handles.clear();
  }

  get #isReshaped() {
    const {feature, isNew} = this.#transaction;
    return !isNew && JSON.stringify(feature.geometry) !== JSON.stringify(this.#openedGeometry);
  }

  // Why the shape of the open edit is none, or null.
  #shapeProblem() {
    const {feature} = this.#transaction;
    const shapeRule = {...this.#rule, properties: {}, requiredAny: undefined};
    return featureProblem({...feature, properties: {}}, shapeRule, this.#context.levels, this.#baseFeature);
  }

  // What the layer would record beside the open edit as it is now, and why it would refuse it.
  #findFollowing() {
    const behaviorContext = this.#context.behaviorContext();
    const refusedFor = problem => ({problem, shapes: [], ghosts: []});
    // A shape that is none yet, such as a line of one point, has nothing that follows it.
    const shapeProblem = this.#shapeProblem();
    if (shapeProblem) return refusedFor(shapeProblem);
    const prepared = this.#behavior.prepared(this.#currentFeature(), behaviorContext, this.#editContext());
    const change = this.#change(prepared);
    const problem = this.#behavior.problem(change, behaviorContext);
    if (problem) return refusedFor(problem);
    const edits = this.#behavior.companionEdits(change, behaviorContext);
    const {session} = this.#context;
    const workingFeature = (filename, key) => session.workingFeature(filename, key);
    return followingEdits(edits, workingFeature, companionEdits => this.#problemOf(companionEdits));
  }

  // Everything that goes along is shown where it would be, with a thin ghost of where it is.
  #renderFollowing() {
    const {overlay} = this.#context;
    const nothing = {problem: null, shapes: [], ghosts: []};
    const isDragging = Boolean(this.#transaction.gesture);
    const isReshaped = this.#isReshaped;
    const find = () => this.#findFollowing();
    const following = isReshaped ? this.#followingBudget.of(find, isDragging, nothing) : nothing;
    this.#followingProblem = following.problem;
    overlay.setFollowing(following.shapes);
    overlay.setGhosts([...(isReshaped ? [this.#openedGeometry] : []), ...following.ghosts.map(({geometry}) => geometry)]);
  }

  // The neighbours that the open area lies over and did not when it was opened. One geometry keeps one answer until
  // the edit is replaced, so a later render of the same shape does not search the whole file again.
  #findOverlaps() {
    const {key, feature} = this.#transaction;
    const context = this.#context.behaviorContext();
    const entries = context.entriesOf(this.#filename);
    const byGeometry = this.#overlapCache.get(entries) ?? new WeakMap();
    if (byGeometry.has(feature.geometry)) return byGeometry.get(feature.geometry);
    const {mayContainOthers} = this.#behavior;
    const own = {filename: this.#filename, key};
    const isOverlapping = (geometry, other) =>
      hasOutline(geometry) && doOverlap(geometry, other.feature.geometry, mayContainOthers);
    const overlaps = neighbouringAreas(feature.geometry, own, context).filter(
      other => isOverlapping(feature.geometry, other) && !isOverlapping(this.#openedGeometry, other)
    );
    byGeometry.set(feature.geometry, overlaps);
    this.#overlapCache.set(entries, byGeometry);
    return overlaps;
  }

  #renderOverlaps() {
    const {feature, isNew, gesture} = this.#transaction;
    const canOverlap = hasOutline(feature.geometry) && this.#rule && (isNew || this.#isReshaped);
    this.#overlaps = canOverlap ? this.#overlapBudget.of(() => this.#findOverlaps(), Boolean(gesture), []) : [];
    this.#context.overlay.setOverlaps(this.#overlaps.map(({feature: neighbour}) => neighbour));
  }

  get #overlapText() {
    return overlapNotice(this.#overlaps, ({feature}) => this.#behavior.title(feature, this.#context.behaviorContext()));
  }

  #magnetButton() {
    const isOn = isMagnetOn();
    const run = () => {
      setMagnetOn(!isOn);
      this.#update(this.#transaction);
    };
    return {id: 'mode-magnet', label: 'Magnet', isPressed: isOn, run};
  }

  get #hasMagnet() {
    const {tool, feature} = this.#transaction;
    if (!this.#rule) return false;
    const canChangePoint = hasMagnetEffect({
      tool,
      geometry: feature.geometry,
      joins: Boolean(this.#behavior.joinsLines),
      isSketch: this.#filename === sketchFile
    });
    if (!canChangePoint) return false;
    // An outline is not a geometry until its first corner, so the layer cannot judge it yet.
    return [editTools.drawPolygon, editTools.cutHole].includes(tool) || this.#behavior.hasMagnet(feature);
  }

  #drawingButtons() {
    const isPhone = this.#context.isPhone();
    const {drawnPoints} = this.#transaction;
    const pointWord = this.#transaction.tool === editTools.drawLine ? 'point' : 'corner';
    const addButton = {
      id: 'mode-add',
      label: `Add ${pointWord}`,
      isPrimary: true,
      run: () => this.#addPointUnderCross()
    };
    return [
      {
        id: 'mode-undo',
        label: isPhone ? 'Undo' : `Undo ${pointWord}`,
        isDisabled: drawnPoints.length === 0,
        run: () => this.#update(afterUndoneDrawnPoint(this.#transaction))
      },
      ...(isPhone ? [addButton] : []),
      ...(this.#hasMagnet ? [this.#magnetButton()] : []),
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
    const magnet = this.#hasMagnet ? [this.#magnetButton()] : [];
    if (!this.#isVertexTool) return [...magnet, done];
    const remove = {
      id: 'vertex-remove',
      label: 'Remove point',
      isDisabled: !this.#transaction.selectedHandle,
      run: () => this.#removeSelectedVertex()
    };
    const {feature, selectedHandle} = this.#transaction;
    return [remove, ...this.#behavior.vertexTools(feature, selectedHandle, this.#editContext()), ...magnet, done];
  }

  #renderModeBar(nextPoint) {
    const transaction = this.#transaction;
    setCrossVisible(this.#context.isPhone() && (isDrawing(transaction) || this.#isPlacing));
    if (!transaction.tool) {
      hideModeBar();
      return;
    }
    const isPhone = this.#context.isPhone();
    const title = this.#behavior.title(transaction.feature, this.#context.behaviorContext());
    const measure = drawingMeasure(transaction, nextPoint);
    const hint = [this.#dragTarget()?.label, drawingHint(transaction.tool, isPhone), measure].filter(Boolean).join(' · ');
    let buttons = this.#reshapingButtons();
    if (this.#isPlacing) buttons = this.#placingButtons();
    else if (isDrawing(transaction)) buttons = this.#drawingButtons();
    showModeBar({
      title: transaction.isNew ? elementById('selection-title').textContent : title,
      hint,
      notice: this.#followingProblem ?? this.#overlapText,
      buttons
    });
  }

  // The object of the open edit, as the rest of the editor names it.
  #entry() {
    const {key, feature, isNew} = this.#transaction;
    return {filename: this.#filename, key, feature, isNew};
  }

  #renderToolButtons() {
    const {isNew, feature} = this.#transaction;
    const geometryType = feature.geometry?.type;
    const isShape = Boolean(geometryType) && geometryType !== 'Point';
    const {canReshape, canDelete} = featureCapabilities(feature, this.#rule);
    const isReshapableHere = this.#behavior.isReshapable(this.#context.behaviorContext());
    const canEditShape = (isNew || canReshape) && Boolean(geometryType) && isReshapableHere;
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
    const notice = createElementWithText('p', this.#overlapText ?? '');
    notice.className = 'notice';
    const notices = this.#overlapText ? [notice] : [];
    elementById('edit-facts').replaceChildren(...facts.map(fact => createElementWithText('p', fact)), ...notices);
  }

  // What a layer may do with the open edit. A control can act late, after a pick on the map or an answer of the device:
  // once its edit is closed it changes nothing, and never the edit opened since.
  #editContext() {
    const opening = this.#opening;
    const isOpen = () => this.#transaction !== null && this.#opening === opening;
    const whileOpen = run => (...values) => {
      if (isOpen()) run(...values);
    };
    return {
      isOpen,
      // The feature with what is typed in the form.
      typedFeature: () => this.#currentFeature(),
      feature: this.#transaction.feature,
      key: this.#transaction.key,
      filename: this.#filename,
      isNew: this.#transaction.isNew,
      context: this.#context.behaviorContext(),
      setProperties: whileOpen(properties => this.#setProperties(properties)),
      extras: this.#transaction.extras,
      // A control that outlives one rendering reads the edit as it is then.
      latest: () => this.#editContext(),
      origins: this.#transaction.origins,
      setExtras: whileOpen(extras => this.#setExtras(extras)),
      setFeature: whileOpen(feature => this.#setFeature(feature)),
      setGeometry: whileOpen(geometry => this.#setFeature({...this.#currentFeature(), geometry})),
      startTool: whileOpen(tool => this.#startTool(tool)),
      hasUnappliedEdit: () => this.hasUnappliedEdit,
      showProblem: whileOpen(message => this.#refuse(message)),
      // For an answer that comes late and interrupts nothing.
      showMessage: whileOpen(message => this.showProblem(message)),
      applyWith: whileOpen(edits => this.#applyWith(edits)),
      replaceWith: whileOpen((edits, message) => this.#replaceWith(edits, message)),
      discard: whileOpen(() => this.discardEdit())
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

  #setExtras(extras) {
    const {feature} = this.#transaction;
    const changed = {...withTypedDetails(this.#transaction), extras: {...this.#transaction.extras, ...extras}};
    this.#transaction = {...changed, feature: {...feature, properties: this.#currentFeature().properties}};
    this.#renderForm();
    this.#update(this.#transaction);
  }

  // Replaces the pending feature, its typed details included.
  #setFeature(feature) {
    this.#transaction = withReplacedFeature(this.#transaction, feature);
    this.#renderForm();
    this.#update(this.#transaction);
  }

  // The kinds on offer follow the category. Rendering again must not drop a keyboard user out of the form.
  #renderDependentLists(field) {
    if (!this.#behavior.listsDependOn.includes(field.name)) return;
    this.#setProperties({});
    elementById('property-form').elements[field.name].focus();
  }

  #renderForm() {
    const {levels} = this.#context;
    const {feature} = this.#transaction;
    const editContext = this.#editContext();
    renderPropertyForm(elementById('property-form'), feature.properties, this.#rule.properties, levels, {
      sections: this.#behavior.sections(feature, editContext),
      controls: {...formControls(editContext), ...this.#behavior.controls(editContext)},
      usualValues: {
        ...usualValuesOf(this.#filename, feature, editContext.context),
        ...this.#behavior.usualValues(feature, editContext.context)
      }
    });
    const extras = elementById('inspector-extras');
    extras.replaceChildren();
    this.#behavior.renderExtras(extras, this.#editContext());
  }

  #update(transaction) {
    this.#transaction = transaction;
    this.showProblem(null);
    elementById('editor').hidden = false;
    elementById('edit-actions').hidden = false;
    elementById('apply-edit').hidden = this.#behavior.isViewOnly(this.#context.behaviorContext());
    const applyLabel = this.#behavior.applyLabel(this.#editContext());
    elementById('apply-edit').textContent = this.#context.isResolving(this.#entry()) ? 'Apply and resolve' : applyLabel;
    elementById('leave-note').hidden = this.#transaction.isNew || this.#behavior.isDerived;
    this.#renderToolButtons();
    const nextPoint =
      isDrawing(this.#transaction) || this.#isPlacing ? this.#nextDrawnPoint() : null;
    this.#renderGeometry(nextPoint);
    this.#renderFacts();
    this.#renderModeBar(nextPoint);
    this.#context.onEditStateChanged();
  }

  #open(filename, transaction) {
    this.#opening += 1;
    this.#filename = filename;
    this.#transaction = transaction;
    this.#openedGeometry = transaction.feature.geometry;
    this.#followingBudget.forget();
    this.#overlapBudget.forget();
    this.#overlapCache = new WeakMap();
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
    overlay.setGhosts([]);
    overlay.setFollowing([]);
    overlay.setOverlaps([]);
    overlay.setTarget(null);
    overlay.setPath([]);
    this.#context.showMarks([]);
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
    const edit = this.#change(feature);
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

  // The open edit as the layer sees it.
  #change(feature) {
    const {key, extras, origins} = this.#transaction;
    return {filename: this.#filename, key, feature, extras, origins, before: this.#workingBefore()};
  }

  // Why the importer would refuse an edit that goes along with this one, or null. Nobody sees those before the export.
  #problemOf(edits) {
    const {rules, levels, session} = this.#context;
    for (const {filename, key, after} of edits) {
      const before = session.baseFeature(filename, key);
      const isUnchanged = !after || JSON.stringify(before) === JSON.stringify(after);
      if (isUnchanged) continue;
      const operation = {filename, operation: before ? 'modify' : 'add', reference: {localId: key}, before, after};
      const problem = operationProblem(operation, rules, levels);
      if (problem) return `${behaviorOf(filename).title(after, this.#context.behaviorContext())}: ${problem}.`;
    }
    return null;
  }

  // Records the edit together with others of the same step.
  #applyWith(extraEdits) {
    if (isDrawing(this.#transaction)) return this.#refuse('Finish drawing first.');
    const {feature, problem} = this.#validatedFeature();
    if (problem) return this.#refuse(problem);
    if (this.#behavior.record) return this.#recordElsewhere(feature);
    const edit = this.#change(feature);
    const behaviorContext = this.#context.behaviorContext();
    const companions = this.#behavior.companionEdits(edit, behaviorContext);
    const ownEdits = this.#behavior.isDerived ? [] : [{filename: this.#filename, key: edit.key, after: feature}];
    const edits = [...ownEdits, ...companions, ...extraEdits];
    const invalidEdit = this.#problemOf(edits);
    if (invalidEdit) return this.#refuse(invalidEdit);
    const title = this.#behavior.title(feature, behaviorContext);
    const isRecorded = this.#context.commands.recordEdits(edits);
    const {afterApply} = this.#behavior;
    const entry = this.#entry();
    this.#finishEdit(() => this.#context.onRecorded(isRecorded ? `Applied · ${title}` : null, entry));
    afterApply({feature, filename: edit.filename, key: edit.key}, behaviorContext);
    return {success: true};
  }

  // A sketch is no edit of a source, so no command records it.
  #recordElsewhere(feature) {
    const {record} = this.#behavior;
    const {key} = this.#transaction;
    const behaviorContext = this.#context.behaviorContext();
    this.#finishEdit(() => record({key, feature}, behaviorContext));
    return {success: true};
  }

  // Drops the open edit and records others in its place, such as marking the building as having no number.
  #replaceWith(edits, message) {
    const invalidEdit = this.#problemOf(edits);
    if (invalidEdit) {
      this.#refuse(invalidEdit);
      return;
    }
    this.#context.commands.recordEdits(edits);
    const entry = this.#entry();
    this.#finishEdit(() => this.#context.onRecorded(message, entry));
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
    const entry = this.#entry();
    this.#finishEdit(() => this.#context.onRecorded(`Deleted · ${title}`, entry));
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
    const {problem, message, edits, options = []} = this.#behavior.deletion(entry, behaviorContext);
    if (problem) {
      this.showProblem(problem);
      return;
    }
    const ownEdit = {filename: entry.filename, key: entry.key, after: null};
    confirmDeletion({title: `Delete ${title}?`, message, options}, async option => {
      const optionEdits = option?.resolve ? await option.resolve() : (option?.edits ?? []);
      if (optionEdits) this.#recordDeletion([ownEdit, ...edits, ...optionEdits], title);
    });
  }

  #leaveNote() {
    const entry = {filename: this.#filename, key: this.#transaction.key, feature: this.#workingBefore()};
    const title = this.#behavior.title(entry.feature, this.#context.behaviorContext());
    this.#context.onNoteWanted(entry, title);
  }

  #removeSelectedVertex() {
    this.#update(withoutVertex(this.#transaction, this.#transaction.selectedHandle));
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
    // What the inspector says about the object may depend on where it is now.
    this.#renderForm();
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

  #addPointUnderCross() {
    const {map} = this.#context;
    const lngLat = map.getCenter();
    const {drawnPoints} = this.#transaction;
    this.#addDrawnPoint(this.#snappedPoint({lngLat, point: map.project(lngLat)}, drawnPoints) ?? lngLat.toArray());
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

  // The place an area's corner goes to, or null. Points already in the shape are kept apart.
  #magneticCorner(coordinate, usedPoints = []) {
    const own = {filename: this.#filename, key: this.#transaction.key};
    const reach = reachMetres(coordinate, this.#context.map);
    return magneticPoint(
      coordinate,
      areasAround(coordinate, own, this.#context.behaviorContext(), reach),
      reach,
      usedPoints
    );
  }

  // A dragged corner, or the whole area, put beside its neighbours.
  #magnetised(transaction) {
    const {feature, gesture, key} = transaction;
    if (!isMagnetOn() || !hasOutline(feature.geometry)) return transaction;
    const handles = vertexHandles(feature.geometry);
    const {handle} = gesture;
    if (handle) {
      const {coordinate} = handles.find(other => isSameHandle(other, handle));
      const usedPoints = handles.filter(other => !isSameHandle(other, handle)).map(other => other.coordinate);
      const target = this.#magneticCorner(coordinate, usedPoints);
      return target ? withGeometry(transaction, moveVertex(feature.geometry, handle, target)) : transaction;
    }
    const reach = reachMetres(handles[0].coordinate, this.#context.map);
    const own = {filename: this.#filename, key};
    const neighbours = neighbouringAreas(feature.geometry, own, this.#context.behaviorContext(), reach);
    return withGeometry(transaction, magneticallyMoved(feature.geometry, neighbours, reach));
  }

  // A dragged point stops where the layer's rules say it must, such as at the next contour line.
  #draggedTransaction(transaction, coordinate) {
    const moved = this.#magnetised(afterGestureMove(transaction, coordinate));
    const limit = this.#behavior.limitedGeometry;
    if (!limit) return moved;
    const behaviorContext = this.#context.behaviorContext();
    const {feature, key} = transaction;
    const draggedIndex = transaction.gesture.handle?.vertexIndex ?? null;
    const edit = {filename: this.#filename, key, feature, previousGeometry: feature.geometry, origins: transaction.origins, draggedIndex};
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
      const nextPoint = this.#nextDrawnPoint();
      this.#context.overlay.setDrawing(this.#transaction.drawnPoints, nextPoint);
      this.#renderModeBar(nextPoint);
    };
    this.#context.map.on('mousemove', event => {
      this.#pointer = isDrawing(this.#transaction) ? this.#drawnCoordinate(event) : event.lngLat.toArray();
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
    onClick('leave-note', () => this.#leaveNote());
    elementById('property-form').oninput = () => this.#update(withTypedDetails(this.#transaction));
    elementById('property-form').onchange = event => this.#renderDependentLists(event.target);
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
    const isOpenLine = this.#transaction.tool === editTools.drawLine && !this.#behavior.closesLines;
    if (isOpenLine) return false;
    return event.point.dist(this.#context.map.project(firstPoint)) <= closingDistancePixels;
  }

  // Where a layer says a point belongs, such as on the outline of a building, or null. While drawing an outline or a
  // hole, the magnet also joins what is near, except at points the shape already has.
  #snappedPoint(event, usedPoints = []) {
    const snapped = this.#behavior.snappedPoint?.(event, this.#context.behaviorContext(), this.#transaction.feature);
    if (snapped) return snapped;
    const isOutline = [editTools.drawPolygon, editTools.cutHole].includes(this.#transaction.tool);
    if (!isOutline || !isMagnetOn()) return null;
    return this.#magneticCorner(event.lngLat.toArray(), usedPoints);
  }

  // Shift keeps right angles while drawing a building or any other shape. A layer can join a tap to what is there.
  #drawnCoordinate(event) {
    const usedPoints = this.#transaction.drawnPoints;
    return this.#isAngleKept(event)
      ? this.#angledCoordinate(event)
      : (this.#snappedPoint(event, usedPoints) ?? event.lngLat.toArray());
  }

  #isAngleKept(event) {
    return Boolean(event.originalEvent?.shiftKey) && this.#transaction?.tool !== editTools.drawLine;
  }

  // Where the pointer is, kept at a right angle while Shift is held.
  #angledCoordinate(event) {
    const coordinate = event.lngLat.toArray();
    const isAngled = isDrawing(this.#transaction) && this.#isAngleKept(event);
    return isAngled ? rightAngledCorner(this.#transaction.drawnPoints, coordinate) : coordinate;
  }

  tap(event) {
    if (this.#isPlacing) {
      this.#placePoint(this.#snappedPoint(event) ?? event.lngLat.toArray());
      return;
    }
    if (this.#isClosingTap(event)) {
      const {tool, drawnPoints} = this.#transaction;
      if (tool === editTools.drawLine) this.#addDrawnPoint(drawnPoints[0]);
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
