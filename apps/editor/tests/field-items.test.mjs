import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldItemLabel, fieldItemProblem, isReferencedObject, newDeletionMark, newNote, referenceTo} from '../src/editing/field-items.js';
import {layerForSketch, sketchBehaviors, sketchFile, sketchRule} from '../src/layers/shared/layer-sketches.js';
import {featureProblem} from '../src/layers/shared/layer-rules.js';

const building = {
  filename: 'buildings.geojson',
  key: '3',
  feature: {
    type: 'Feature',
    properties: {entityId: 'way/9', entityPart: 1},
    geometry: {type: 'Polygon', coordinates: []}
  }
};

test('a field item names its object by identity, so another device finds the same one', () => {
  assert.deepEqual(referenceTo(building), {entityId: 'way/9', entityPart: 1});
  assert.deepEqual(referenceTo({key: 'local:1', feature: {properties: {}}}), {localId: 'local:1'});
  assert.deepEqual(referenceTo({key: '4', feature: {properties: {}}}), {featureIndex: 4});
  const elsewhere = {...building, key: '88'};
  assert.equal(isReferencedObject(elsewhere, newDeletionMark(building, 'Main street 9', 'buildings').target.reference), true);
});

test('items say what they are in Changes', () => {
  assert.deepEqual(fieldItemLabel(newDeletionMark(building, 'Main street 9', 'buildings')), {
    title: 'Marked for deletion',
    detail: 'Building · Main street 9'
  });
  assert.deepEqual(fieldItemLabel(newNote(building, 'Main street 9', 'buildings', 'Has one more floor')), {
    title: 'Note on Main street 9',
    detail: 'Has one more floor'
  });
  const sketch = {type: 'sketch', what: 'Parking', note: 'Gravel', createdAt: '2026-11-25T14:20:00Z'};
  const label = fieldItemLabel(sketch);
  assert.equal(label.title, 'New · Parking');
  assert.match(label.detail, /^Sketch · 25 Nov.* · Gravel$/);
});

test('a sketch is finished on the layer of what it is, and is saved without touching a source', () => {
  assert.equal(layerForSketch('Water', 'roads'), 'water');
  assert.equal(layerForSketch('Other', 'roads'), 'roads');
  const feature = {
    type: 'Feature',
    properties: {what: 'Playground', note: 'Sand and two swings'},
    geometry: {type: 'Polygon', coordinates: [[[19, 42], [19.1, 42], [19.1, 42.1], [19, 42]]]}
  };
  assert.equal(featureProblem(feature, sketchRule, new Set()), null);
  assert.match(featureProblem({...feature, properties: {}}, sketchRule, new Set()), /what is required/);
  const saved = [];
  sketchBehaviors[sketchFile].record({key: 'local:1', feature}, {saveSketch: sketch => saved.push(sketch)});
  assert.equal(saved[0].id, 'local:1');
  assert.equal(saved[0].what, 'Playground');
  assert.deepEqual(saved[0].geometry, feature.geometry);
});

test('a rough sketch never offers the magnet', () => {
  const behavior = sketchBehaviors[sketchFile];
  const feature = {
    type: 'Feature',
    properties: {what: 'Other'},
    geometry: {type: 'Polygon', coordinates: [[[19, 42], [19.1, 42], [19.1, 42.1], [19, 42]]]}
  };
  assert.equal(behavior.hasMagnet(feature), false);
  assert.equal(behavior.hasMagnet(feature, true), false);
});

const sketchItem = {
  id: 'local:1',
  type: 'sketch',
  createdAt: '2026-11-25T14:20:00Z',
  layer: 'green',
  what: 'Parking',
  geometry: {type: 'Polygon', coordinates: [[[19, 42], [19.1, 42], [19.1, 42.1], [19, 42]]]}
};
const noteItem = {
  ...sketchItem,
  type: 'note',
  note: 'One more floor',
  geometry: {type: 'Point', coordinates: [19, 42]},
  target: {filename: 'buildings.geojson', reference: {entityId: 'way/9'}, name: 'Main street 9'}
};

for (const [name, item] of [
  ['no shape', {...sketchItem, geometry: null}],
  ['a shape without coordinates', {...sketchItem, geometry: {type: 'Polygon'}}],
  ['a shape of text', {...sketchItem, geometry: {type: 'Point', coordinates: ['19', '42']}}],
  ['a shape of no known type', {...sketchItem, geometry: {type: 'GeometryCollection', geometries: []}}],
  ['no layer', {...sketchItem, layer: undefined}],
  ['another layer', {...sketchItem, layer: 'shopping'}],
  ['no kind', {...sketchItem, what: 7}],
  ['a long note', {...sketchItem, note: 'x'.repeat(2001)}],
  ['a note without text', {...noteItem, note: ' '}],
  ['a note on nothing', {...noteItem, target: undefined}],
  ['a note on an unnamed object', {...noteItem, target: {...noteItem.target, name: null}}],
  ['a note in an unknown file', {...noteItem, target: {...noteItem.target, filename: 'secrets.json'}}],
  ['no local ID', {...sketchItem, id: 'way/9'}]
]) {
  test(`an imported field item with ${name} is refused before it can be drawn`, () => {
    assert.equal(typeof fieldItemProblem(item, ['buildings.geojson']), 'string');
  });
}

test('field items that can be drawn are accepted', () => {
  for (const item of [sketchItem, noteItem, {...noteItem, type: 'deletion', note: undefined}]) {
    assert.equal(fieldItemProblem(item, ['buildings.geojson']), null);
  }
});
