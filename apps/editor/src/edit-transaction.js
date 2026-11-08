import {appendLinePoint, moveVertex, roundedCoordinate, translateGeometry, vertexHandles} from './geometry-editing.js';

// One pending edit of one feature. Nothing here touches the session: Apply records the result as a single
// undoable step, and Cancel drops the transaction. Escape only interrupts the current gesture.
export const editTools = {
  placePoint: 'place-point',
  drawLine: 'draw-line',
  vertices: 'vertices',
  move: 'move'
};

const newTransaction = (key, feature, tool, isNew) => ({
  key,
  feature,
  tool,
  isNew,
  selectedHandle: null,
  gesture: null,
  hasTypedDetails: false,
  hasUnappliedEdit: isNew
});

export const beginExistingEdit = (key, feature) => newTransaction(key, structuredClone(feature), null, false);

export const beginNewPoint = (key, properties) =>
  newTransaction(key, {type: 'Feature', properties, geometry: null}, editTools.placePoint, true);

export const beginNewLine = (key, properties) =>
  newTransaction(
    key,
    {type: 'Feature', properties, geometry: {type: 'LineString', coordinates: []}},
    editTools.drawLine,
    true
  );

export const withTool = (transaction, tool) => ({...transaction, tool, selectedHandle: null, gesture: null});

export const withGeometry = (transaction, geometry) => ({
  ...transaction,
  feature: {...transaction.feature, geometry},
  hasUnappliedEdit: true
});

export const withTypedDetails = transaction => ({...transaction, hasTypedDetails: true, hasUnappliedEdit: true});

// A tap places a new point, adds a line point or selects a handle. Moving something is always a relative drag, so a
// tap can never make an existing feature jump to the contact point. A placed point can then be adjusted the same way.
export function afterMapTap(transaction, coordinate, tappedHandle) {
  const {tool, feature} = transaction;
  if (tool === editTools.placePoint) {
    const placed = withGeometry(transaction, {type: 'Point', coordinates: roundedCoordinate(coordinate)});
    return {...placed, tool: editTools.move};
  }
  if (tool === editTools.drawLine) return withGeometry(transaction, appendLinePoint(feature.geometry, coordinate));
  if (tool === editTools.vertices && tappedHandle) return {...transaction, selectedHandle: tappedHandle};
  return transaction;
}

// Starts a drag if this press can move something: the whole feature anywhere on the map, or the pressed handle, or
// the selected handle from anywhere. Otherwise the transaction is returned as it is, and the map pans as usual.
export function beginGesture(transaction, coordinate, pressedHandle) {
  const {tool, feature, selectedHandle, hasUnappliedEdit} = transaction;
  const handle = tool === editTools.vertices ? (pressedHandle ?? selectedHandle) : null;
  const canMove = feature.geometry && (tool === editTools.move || handle);
  if (!canMove) return transaction;
  const gesture = {
    startCoordinate: coordinate,
    startGeometry: feature.geometry,
    hadUnappliedEdit: hasUnappliedEdit,
    handle
  };
  return {...transaction, selectedHandle: handle, gesture};
}

const isSameHandle = (first, second) =>
  first.ringIndex === second.ringIndex && first.vertexIndex === second.vertexIndex;

// Every position is computed from where the gesture started, so moves add up without drifting or jumping.
export function afterGestureMove(transaction, coordinate) {
  const {startCoordinate, startGeometry, handle} = transaction.gesture;
  const longitudeOffset = coordinate[0] - startCoordinate[0];
  const latitudeOffset = coordinate[1] - startCoordinate[1];
  if (!handle) return withGeometry(transaction, translateGeometry(startGeometry, longitudeOffset, latitudeOffset));
  const [longitude, latitude] = vertexHandles(startGeometry).find(other => isSameHandle(other, handle)).coordinate;
  const movedVertex = [longitude + longitudeOffset, latitude + latitudeOffset];
  return withGeometry(transaction, moveVertex(startGeometry, handle, movedVertex));
}

export const endGesture = transaction => ({...transaction, gesture: null});

// An interrupted gesture restores the preview it started from, including earlier gestures of this edit.
export function cancelGesture(transaction) {
  const {startGeometry, hadUnappliedEdit} = transaction.gesture;
  return {
    ...transaction,
    feature: {...transaction.feature, geometry: startGeometry},
    gesture: null,
    hasUnappliedEdit: hadUnappliedEdit
  };
}
