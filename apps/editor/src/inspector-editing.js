import {elementById} from './dom.js';
import {installDragGestures} from './drag-gestures.js';
import {
  afterGestureMove,
  afterMapTap,
  beginExistingEdit,
  beginGesture,
  beginNewLine,
  beginNewPoint,
  cancelGesture,
  editTools,
  endGesture,
  withGeometry,
  withTool,
  withTypedDetails
} from './edit-transaction.js';
import {insertVertex, removeVertex} from './geometry-editing.js';
import {featureCapabilities, featureProblem} from './layer-rules.js';
import {propertiesFromForm, renderPropertyForm} from './property-form.js';

const toolHints = {
  [editTools.placePoint]: 'Tap the map to set the position, then Apply.',
  [editTools.drawLine]: 'Tap the map to add each point, then Apply.',
  [editTools.vertices]: 'Tap a corner or point to select it, then drag anywhere to move it. Drag again to adjust.',
  [editTools.move]: 'Drag anywhere on the map to move it. Drag again to adjust, then Apply.'
};

// Owns the pending edit in the inspector: its form, geometry tools and the Apply or Cancel decision.
// context: {commands, session, rules, levels, handles, overlay, map, activeFile(), onRecorded(), onClosed(),
// releaseInspectorFocus(), focusStatus(), onEditStateChanged()}. releaseInspectorFocus parks focus outside the inspector
// and returns whether the inspector held focus, so the status is focused only when it was needed.
export class InspectorEditing {
  #context;
  #transaction = null;

  constructor(context) {
    this.#context = context;
  }

  get #activeRule() {
    return this.#context.rules.layers[this.#context.activeFile()];
  }

  get #isVertexTool() {
    return this.#transaction?.tool === editTools.vertices;
  }

  showProblem(message) {
    elementById('edit-problem').textContent = message ?? '';
    elementById('edit-problem').hidden = !message;
  }

  #renderPreview() {
    const geometry = this.#transaction.feature.geometry;
    const canDrawSelection = geometry && geometry.coordinates.length > 0;
    this.#context.overlay.setSelection(canDrawSelection ? this.#transaction.feature : null);
    if (this.#isVertexTool) this.#context.handles.show(geometry, this.#transaction.selectedHandle);
    else this.#context.handles.clear();
  }

  #renderToolButtons() {
    const {isNew, feature, tool} = this.#transaction;
    const geometryType = feature.geometry?.type;
    const isShape = geometryType === 'LineString' || geometryType === 'Polygon';
    const {canDelete} = featureCapabilities(feature, this.#activeRule);
    elementById('tool-move').hidden = isNew || !geometryType;
    elementById('tool-move').textContent = isShape ? 'Move whole shape' : 'Move point';
    elementById('tool-vertices').hidden = isNew || !isShape;
    elementById('vertex-insert').hidden = !this.#isVertexTool;
    elementById('vertex-remove').hidden = !this.#isVertexTool;
    elementById('delete-feature').hidden = isNew || !canDelete;
    elementById('tool-hint').textContent = toolHints[tool] ?? '';
  }

  #update(transaction) {
    this.#transaction = transaction;
    this.showProblem(null);
    elementById('editor').hidden = false;
    elementById('edit-actions').hidden = false;
    this.#renderToolButtons();
    this.#renderPreview();
    this.#context.onEditStateChanged();
  }

  #open(transaction) {
    const {rules, levels, activeFile} = this.#context;
    const propertyRules = rules.layers[activeFile()].properties;
    renderPropertyForm(elementById('property-form'), transaction.feature.properties, propertyRules, levels);
    this.#update(transaction);
  }

  openExisting(key, feature) {
    this.#open(beginExistingEdit(key, feature));
  }

  openNewPoint(key, properties) {
    this.#open(beginNewPoint(key, properties));
  }

  openNewLine(key, properties) {
    this.#open(beginNewLine(key, properties));
  }

  close() {
    this.#transaction = null;
    this.showProblem(null);
    elementById('editor').hidden = true;
    elementById('edit-actions').hidden = true;
    this.#context.handles.clear();
    this.#context.overlay.setSelection(null);
    this.#context.onEditStateChanged();
  }

  // The result of Apply, or a message explaining why it cannot be recorded yet.
  #validatedFeature() {
    const {key, feature: current} = this.#transaction;
    if (!current.geometry) return {problem: 'Tap the map to set the position first.'};
    const formValues = Object.fromEntries(new FormData(elementById('property-form')));
    const properties = propertiesFromForm(current.properties, formValues, this.#activeRule.properties);
    const feature = {...current, properties};
    const before = this.#context.session.baseFeature(this.#context.activeFile(), key);
    return {feature, problem: featureProblem(feature, this.#activeRule, this.#context.levels, before)};
  }

  // Release focus before hiding the inspector; focus the status only after its text has been updated.
  #finishEdit(afterClose) {
    const hadInspectorFocus = this.#context.releaseInspectorFocus();
    this.close();
    afterClose();
    if (hadInspectorFocus) this.#context.focusStatus();
  }

  #apply() {
    const {feature, problem} = this.#validatedFeature();
    if (problem) {
      this.showProblem(problem);
      return;
    }
    this.#context.commands.recordEdit(this.#transaction.key, feature);
    this.#finishEdit(() => this.#context.onRecorded());
  }

  #cancel() {
    this.#finishEdit(() => this.#context.onClosed());
  }

  #deleteFeature() {
    this.#context.commands.recordEdit(this.#transaction.key, null);
    this.#finishEdit(() => this.#context.onRecorded());
  }

  #changeSelectedVertex(changeGeometry) {
    const {selectedHandle, feature} = this.#transaction;
    if (!selectedHandle) {
      this.showProblem('Select a corner or point first.');
      return;
    }
    const geometry = changeGeometry(feature.geometry, selectedHandle);
    this.#update({...withGeometry(this.#transaction, geometry), selectedHandle: null});
  }

  #startGesture(event) {
    if (!this.#transaction) return false;
    const pressedHandle = this.#isVertexTool ? this.#context.handles.handleAt(event.point) : null;
    const next = beginGesture(this.#transaction, event.lngLat.toArray(), pressedHandle);
    if (!next.gesture) return false;
    this.#update(next);
    return true;
  }

  // Each handler checks for a live gesture, because Escape or Cancel can end the edit in the middle of a drag.
  #installGestures() {
    const whileDragging = change => {
      if (this.#transaction?.gesture) this.#update(change(this.#transaction));
    };
    installDragGestures(this.#context.map, {
      onStart: event => this.#startGesture(event),
      onMove: coordinate => whileDragging(transaction => afterGestureMove(transaction, coordinate)),
      onEnd: () => whileDragging(endGesture),
      onCancel: () => whileDragging(cancelGesture)
    });
  }

  registerActions() {
    const onClick = (id, action) => {
      elementById(id).onclick = action;
    };
    onClick('tool-move', () => this.#update(withTool(this.#transaction, editTools.move)));
    onClick('tool-vertices', () => this.#update(withTool(this.#transaction, editTools.vertices)));
    onClick('vertex-insert', () => this.#changeSelectedVertex(insertVertex));
    onClick('vertex-remove', () => this.#changeSelectedVertex(removeVertex));
    onClick('cancel-edit', () => this.#cancel());
    onClick('delete-feature', () => this.#deleteFeature());
    elementById('property-form').oninput = () => this.#update(withTypedDetails(this.#transaction));
    elementById('property-form').onsubmit = event => {
      event.preventDefault();
      this.#apply();
    };
    this.#installGestures();
  }

  // Escape rolls back only the drag in progress; previous adjustments and typed fields survive.
  cancelActiveGesture() {
    if (!this.#transaction?.gesture) return false;
    this.#update(cancelGesture(this.#transaction));
    return true;
  }

  get hasGeometryTool() {
    return Boolean(this.#transaction?.tool);
  }

  get hasUnappliedEdit() {
    return Boolean(this.#transaction?.hasUnappliedEdit);
  }

  get hasTypedDetails() {
    return Boolean(this.#transaction?.hasTypedDetails);
  }

  tap(event) {
    const handle = this.#isVertexTool ? this.#context.handles.handleAt(event.point) : null;
    this.#update(afterMapTap(this.#transaction, event.lngLat.toArray(), handle));
  }
}
