import test from 'node:test';
import assert from 'node:assert/strict';
import {greenAreaTest} from '../tools/green-areas.mjs';

const square = (west, south, east, north) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south]
];
const road = (kind, coordinates) => ({properties: {kind}, geometry: {type: 'LineString', coordinates}});

// One park with a hole (a building yard), one non-green area, and the road kinds that take each branch.
test('only walking paths whose middle is inside a green area, outside its holes, are marked', () => {
  const land = [
    {properties: {kind: 'park'}, geometry: {type: 'Polygon', coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)]}},
    {properties: {kind: 'context'}, geometry: {type: 'Polygon', coordinates: [square(20, 0, 30, 10)]}}
  ];
  const isInGreenArea = greenAreaTest(land, ['park']);
  // The middle of this path is inside the park although it starts outside it.
  assert.equal(isInGreenArea(road('footway', [[-4, 2], [8, 2]])), true);
  assert.equal(isInGreenArea(road('path', [[4.5, 5], [5.5, 5]])), false, 'inside the hole');
  assert.equal(isInGreenArea(road('track', [[22, 2], [28, 2]])), false, 'not a green kind');
  assert.equal(isInGreenArea(road('residential', [[1, 1], [3, 1]])), false, 'not a walking path');
});
