import test from 'node:test';
import assert from 'node:assert/strict';
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
  withTool
} from '../src/edit-transaction.js';
import {propertiesFromForm} from '../src/property-form.js';

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [19.25, 42.44],
      [19.251, 42.44],
      [19.251, 42.441],
      [19.25, 42.44]
    ]
  ]
};
const building = {type: 'Feature', properties: {kind: 'building'}, geometry: polygon};
const place = {type: 'Feature', properties: {name: 'Cafe'}, geometry: {type: 'Point', coordinates: [19.25, 42.44]}};

const dragged = (transaction, from, to, handle) =>
  endGesture(afterGestureMove(beginGesture(transaction, from, handle), to));

test('an open edit never changes the feature it started from', () => {
  const transaction = withTool(beginExistingEdit('0', building), editTools.move);
  dragged(transaction, [19.3, 42.3], [19.31, 42.3]);
  assert.deepEqual(building.geometry, polygon);
  assert.equal(transaction.hasUnappliedEdit, false);
});

test('a new point is placed by a tap, which ends the mode, and then only moves relatively', () => {
  const placed = afterMapTap(beginNewPoint('local:1', {}), [19.1, 42.1]);
  assert.deepEqual(placed.feature.geometry, {type: 'Point', coordinates: [19.1, 42.1]});
  assert.equal(placed.tool, null);
  assert.equal(afterMapTap(placed, [19.9, 42.9]), placed, 'a later tap does not make it jump');
  const moved = dragged(withTool(placed, editTools.move), [19.5, 42.5], [19.6, 42.5]);
  assert.deepEqual(moved.feature.geometry.coordinates, [19.2, 42.1]);
  assert.equal(moved.isNew, true);
});

test('a polygon is drawn corner by corner, undone corner by corner, and closes only with three', () => {
  const corners = [
    [19.1, 42.1],
    [19.2, 42.1],
    [19.2, 42.2]
  ];
  const two = corners.slice(0, 2).reduce(afterDrawnPoint, beginNewPolygon('local:1', {}));
  assert.equal(canFinishDrawing(two), false);
  const three = afterDrawnPoint(two, corners[2]);
  assert.equal(canFinishDrawing(three), true);
  assert.deepEqual(afterUndoneDrawnPoint(three).drawnPoints, two.drawnPoints);
  const finished = finishDrawing(three);
  assert.deepEqual(finished.feature.geometry, {type: 'Polygon', coordinates: [[...corners, corners[0]]]});
  assert.equal(finished.tool, null);
});

test('a hole is drawn inside a shape without changing its outline, and leaving the mode drops it', () => {
  const hole = [
    [19.2502, 42.4401],
    [19.2505, 42.4401],
    [19.2505, 42.4402]
  ];
  const cutting = hole.reduce(afterDrawnPoint, withTool(beginExistingEdit('0', building), editTools.cutHole));
  assert.deepEqual(cutting.feature.geometry, polygon, 'the outline stands until the hole is finished');
  assert.deepEqual(finishDrawing(cutting).feature.geometry.coordinates, [polygon.coordinates[0], [...hole, hole[0]]]);
  assert.deepEqual(withTool(cutting, null).feature.geometry, polygon);
});

test('a tap on the middle of a side adds a point there, and a press on it drags the new point', () => {
  const editing = withTool(beginExistingEdit('0', building), editTools.vertices);
  const middle = {ringIndex: 0, vertexIndex: 0, isMidpoint: true};
  const added = afterMapTap(editing, [19.2505, 42.44], middle);
  assert.deepEqual(added.feature.geometry.coordinates[0][1], [19.2505, 42.44]);
  assert.deepEqual(added.selectedHandle, {ringIndex: 0, vertexIndex: 1});
  const pressed = beginGesture(editing, [19.2505, 42.44], middle);
  const movedPoint = afterGestureMove(pressed, [19.2505, 42.4395]).feature.geometry.coordinates[0][1];
  assert.deepEqual(movedPoint, [19.2505, 42.4395]);
});

test('drawing appends each tapped point', () => {
  const first = afterMapTap(beginNewLine('local:1', {}), [19.1, 42.1]);
  const second = afterMapTap(first, [19.2, 42.2]);
  assert.deepEqual(second.feature.geometry.coordinates, [
    [19.1, 42.1],
    [19.2, 42.2]
  ]);
});

test('a move starts anywhere, does not jump to the contact point, and several add up', () => {
  const transaction = withTool(beginExistingEdit('0', place), editTools.move);
  const once = dragged(transaction, [20, 43], [20.001, 43]);
  assert.deepEqual(once.feature.geometry.coordinates, [19.251, 42.44]);
  const twice = dragged(once, [21, 44], [21, 44.001]);
  assert.deepEqual(twice.feature.geometry.coordinates, [19.251, 42.441]);
  assert.equal(twice.gesture, null);
  assert.equal(twice.hasUnappliedEdit, true);
});

test('a press that moves nothing leaves no unapplied edit behind', () => {
  const transaction = withTool(beginExistingEdit('0', place), editTools.move);
  const pressed = endGesture(beginGesture(transaction, [20, 43]));
  assert.equal(pressed.hasUnappliedEdit, false);
});

test('an interrupted gesture restores where it started, keeping earlier gestures', () => {
  const transaction = withTool(beginExistingEdit('0', place), editTools.move);
  const cancelledFirst = cancelGesture(afterGestureMove(beginGesture(transaction, [20, 43]), [20.5, 43]));
  assert.deepEqual(cancelledFirst.feature.geometry, place.geometry);
  assert.equal(cancelledFirst.hasUnappliedEdit, false);
  const once = dragged(transaction, [20, 43], [20.001, 43]);
  const cancelledSecond = cancelGesture(afterGestureMove(beginGesture(once, [20, 43]), [20.5, 43]));
  assert.deepEqual(cancelledSecond.feature.geometry, once.feature.geometry);
  assert.equal(cancelledSecond.hasUnappliedEdit, true);
  assert.equal(cancelledSecond.gesture, null);
});

test('the vertex tool starts from a pressed or selected handle, and otherwise leaves the press to the map', () => {
  const transaction = withTool(beginExistingEdit('0', building), editTools.vertices);
  assert.equal(beginGesture(transaction, [19.3, 42.3], null), transaction);
  const handle = {ringIndex: 0, vertexIndex: 1};
  const selected = afterMapTap(transaction, [19.251, 42.44], handle);
  assert.deepEqual(selected.selectedHandle, handle);
  assert.equal(selected.hasUnappliedEdit, false);
  assert.equal(afterMapTap(selected, [19.3, 42.3]), selected, 'a tap elsewhere does not make the vertex jump');
  const moved = dragged(selected, [19.3, 42.3], [19.301, 42.3]);
  assert.deepEqual(moved.feature.geometry.coordinates[0][1], [19.252, 42.44]);
  assert.equal(moved.hasUnappliedEdit, true);
});

test('a dragged first corner keeps the ring closed', () => {
  const transaction = withTool(beginExistingEdit('0', building), editTools.vertices);
  const moved = dragged(transaction, [19.25, 42.44], [19.249, 42.44], {ringIndex: 0, vertexIndex: 0});
  assert.deepEqual(moved.feature.geometry.coordinates[0][0], [19.249, 42.44]);
  assert.deepEqual(moved.feature.geometry.coordinates[0].at(-1), [19.249, 42.44]);
});

test('a whole shape moves with its closing coordinate', () => {
  const transaction = withTool(beginExistingEdit('0', building), editTools.move);
  const moved = dragged(transaction, [20, 43], [20.01, 43]);
  assert.deepEqual(moved.feature.geometry.coordinates[0][0], [19.26, 42.44]);
  assert.deepEqual(moved.feature.geometry.coordinates[0].at(-1), [19.26, 42.44]);
});

test('form values keep unknown properties, drop cleared optional ones and keep levels numeric', () => {
  const propertyRules = {name: {required: true}, phone: {}, visibilityLevel: {isLevel: true}};
  const properties = {name: 'Cafe', phone: '123', visibilityLevel: 3, wikidata: 'Q1'};
  const formValues = {name: '', phone: '', visibilityLevel: '2'};
  assert.deepEqual(propertiesFromForm(properties, formValues, propertyRules), {
    name: '',
    visibilityLevel: 2,
    wikidata: 'Q1'
  });
});

test('an unchanged form changes nothing, including a blank name from the source', () => {
  const propertyRules = {name: {}, kind: {required: true}};
  const properties = {kind: 'tertiary', name: ''};
  const formValues = {name: '', kind: 'tertiary'};
  assert.deepEqual(propertiesFromForm(properties, formValues, propertyRules), properties);
  assert.deepEqual(propertiesFromForm({kind: 'tertiary'}, formValues, propertyRules), {kind: 'tertiary'});
});
