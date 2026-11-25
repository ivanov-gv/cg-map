import test from 'node:test';
import assert from 'node:assert/strict';
import {derivedFacts, lineMiddle} from '../src/derived-facts.js';

const square = [[19, 42], [19.01, 42], [19.01, 42.01], [19, 42.01], [19, 42]];
const hole = [[19.004, 42.004], [19.006, 42.004], [19.006, 42.006], [19.004, 42.006], [19.004, 42.004]];
const land = kind => ({filename: 'land.geojson', feature: {properties: {kind}, geometry: {type: 'Polygon', coordinates: [square, hole]}}});
const path = (coordinates, kind = 'footway') => ({
  filename: 'roads.geojson',
  feature: {type: 'Feature', properties: {kind}, geometry: {type: 'LineString', coordinates}}
});
const inside = [[19.001, 42.001], [19.003, 42.001]];
const factsIn = landEntries => entry => derivedFacts(entry, () => landEntries);

test('a walking path in the middle of a green area is one of a park, and nothing is written to its source', () => {
  const factsOf = factsIn([land('park')]);
  const entry = path(inside);
  assert.deepEqual(factsOf(entry), {inGreenArea: true});
  assert.deepEqual(entry.feature.properties, {kind: 'footway'});
  assert.deepEqual(factsOf(path(inside, 'residential')), {});
  assert.deepEqual(factsOf(path([[19.0049, 42.005], [19.0051, 42.005]])), {}, 'a hole is no park');
  assert.deepEqual(factsOf(path([[19.009, 42.001], [19.02, 42.001]])), {}, 'most of it is outside');
  assert.deepEqual(factsIn([land('context')])(path(inside)), {});
});

test('a path changes its look when the park around it does', () => {
  const entry = path(inside);
  assert.deepEqual(factsIn([land('park')])(entry), {inGreenArea: true});
  assert.deepEqual(factsIn([])(entry), {});
});

test('the middle of a line is halfway along it', () => {
  const [longitude, latitude] = lineMiddle([[19, 42], [19.001, 42], [19.004, 42]]);
  assert.ok(Math.abs(longitude - 19.002) < 1e-9 && Math.abs(latitude - 42) < 1e-9);
  assert.deepEqual(lineMiddle([[19, 42], [19, 42]]), [19, 42]);
});
