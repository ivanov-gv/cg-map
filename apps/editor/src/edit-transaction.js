import {
  insertVertex,
  isSameHandle,
  moveVertex,
  polygonOfCorners,
  roundedCoordinate,
  translateGeometry,
  vertexHandles,
  withHole
} from './geometry-editing.js';

// One pending edit of one feature. Nothing here touches the session: Apply records the result as a single
// undoable step, and Cancel drops the transaction. Escape only interrupts the current gesture.
export const editTools = {
  placePoint: 'place-point',
  drawLine: 'draw-line',
  drawPolygon: 'draw-polygon',
  cutHole: 'cut-hole',
  vertices: 'vertices',
  move: 'move'
};

const drawingTools = new Set([editTools.drawLine, editTools.drawPolygon, editTools.cutHole]);
const minimumPointsByTool = {[editTools.drawLine]: 2, [editTools.drawPolygon]: 3, [editTools.cutHole]: 3};

// drawnPoints are the points of the shape or hole being drawn, in order and open. extras are choices a layer records
// beside the feature, such as the turns at a junction.
const newTransaction = (key, feature, tool, isNew) => ({
  key,
  feature,
  tool,
  isNew,
  selectedHandle: null,
  gesture: null,
  drawnPoints: [],
  extras: {},
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

export const beginNewPolygon = (key, properties) =>
  newTransaction(key, {type: 'Feature', properties, geometry: null}, editTools.drawPolygon, true);

// A record without a place on the map, such as a line.
export const beginNewRecord = (key, properties) =>
  newTransaction(key, {type: 'Feature', properties, geometry: null}, null, true);

export const withTool = (transaction, tool) => ({
  ...transaction,
  tool,
  selectedHandle: null,
  gesture: null,
  drawnPoints: []
});

export const isDrawing = transaction => drawingTools.has(transaction?.tool);
export const canFinishDrawing = transaction =>
  isDrawing(transaction) && transaction.drawnPoints.length >= minimumPointsByTool[transaction.tool];

export const withGeometry = (transaction, geometry) => ({
  ...transaction,
  feature: {...transaction.feature, geometry},
  hasUnappliedEdit: true
});

export const withTypedDetails = transaction => ({...transaction, hasTypedDetails: true, hasUnappliedEdit: true});

// What the map previews while drawing: a line through the points so far, and the finished shape once it can close.
function withDrawnPoints(transaction, drawnPoints) {
  const {tool, feature} = transaction;
  const drawn = {...transaction, drawnPoints, hasUnappliedEdit: true};
  if (tool === editTools.drawLine) return withGeometry(drawn, {type: 'LineString', coordinates: drawnPoints});
  if (tool === editTools.cutHole) return drawn;
  const geometry = drawnPoints.length >= minimumPointsByTool[tool] ? polygonOfCorners(drawnPoints) : null;
  return {...drawn, feature: {...feature, geometry}};
}

export const afterDrawnPoint = (transaction, coordinate) =>
  withDrawnPoints(transaction, [...transaction.drawnPoints, roundedCoordinate(coordinate)]);

export const afterUndoneDrawnPoint = transaction => withDrawnPoints(transaction, transaction.drawnPoints.slice(0, -1));

// Leaves the drawing tool with the finished shape. Callers check canFinishDrawing first.
export function finishDrawing(transaction) {
  const {tool, feature, drawnPoints} = transaction;
  const finished = withTool(transaction, null);
  if (tool !== editTools.cutHole) return finished;
  return withGeometry(finished, withHole(feature.geometry, drawnPoints));
}

function afterHandleTap(transaction, tappedHandle) {
  if (!tappedHandle.isMidpoint) return {...transaction, selectedHandle: tappedHandle};
  const handle = {...tappedHandle};
  delete handle.isMidpoint;
  const geometry = insertVertex(transaction.feature.geometry, handle);
  const selectedHandle = {...handle, vertexIndex: handle.vertexIndex + 1};
  return {...withGeometry(transaction, geometry), selectedHandle};
}

// A tap places a new point, adds a drawn point, selects a handle or adds one on a side. Moving something is always a
// relative drag, so a tap can never make an existing feature jump to the contact point.
export function afterMapTap(transaction, coordinate, tappedHandle) {
  const {tool} = transaction;
  if (tool === editTools.placePoint) {
    const placed = withGeometry(transaction, {type: 'Point', coordinates: roundedCoordinate(coordinate)});
    return withTool(placed, null);
  }
  if (isDrawing(transaction)) return afterDrawnPoint(transaction, coordinate);
  if (tool === editTools.vertices && tappedHandle) return afterHandleTap(transaction, tappedHandle);
  return transaction;
}

// Starts a drag if this press can move something: the whole feature anywhere on the map, or the pressed handle, or
// the selected handle from anywhere. Otherwise the transaction is returned as it is, and the map pans as usual.
export function beginGesture(transaction, coordinate, pressedHandle) {
  if (transaction.tool === editTools.vertices && pressedHandle?.isMidpoint) {
    return beginGesture(afterHandleTap(transaction, pressedHandle), coordinate, null);
  }
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
