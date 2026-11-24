import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldItemLabel, isReferencedObject, newDeletionMark, newNote, referenceTo} from '../src/field-items.js';
import {layerForSketch, sketchBehaviors, sketchFile, sketchRule} from '../src/layer-sketches.js';
import {featureProblem} from '../src/layer-rules.js';

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
