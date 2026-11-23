import test from 'node:test';
import assert from 'node:assert/strict';
import {reversedCanyonRims, reversedSummitContours} from '../tools/relief-directions.mjs';

const collection = features => ({type: 'FeatureCollection', features});
const line = (coordinates, properties) => ({type: 'Feature', properties, geometry: {type: 'LineString', coordinates}});

// A river flowing east along latitude 42: its north bank is on the left, so that rim must run east.
test('a canyon rim with its river on the left is reported', () => {
  const water = collection([line([[19.0, 42.0], [19.01, 42.0]], {kind: 'river', name: 'Ribnica'})]);
  const rim = coordinates => line(coordinates, {river: 'Ribnica', bank: 'left'});
  const eastward = rim([[19.002, 42.0003], [19.008, 42.0003]]);
  const westward = rim([[19.008, 42.0003], [19.002, 42.0003]]);
  assert.deepEqual(reversedCanyonRims(collection([eastward, westward]), water), [westward]);
});

// The closest ring around a summit must run counter-clockwise, keeping the rising ground on its left.
test('a contour ring around a summit running clockwise is reported', () => {
  const square = [[19.0, 42.0], [19.01, 42.0], [19.01, 42.01], [19.0, 42.01], [19.0, 42.0]];
  const counterClockwise = line(square, {elevation: 100});
  const clockwise = line([...square].reverse(), {elevation: 120});
  const summit = elevation => ({type: 'Feature', properties: {enclosingContourElevation: elevation}, geometry: {type: 'Point', coordinates: [19.005, 42.005]}});
  const result = reversedSummitContours(collection([counterClockwise, clockwise]), collection([summit(100), summit(120)]));
  assert.equal(result.checkedCount, 2);
  assert.deepEqual(result.reversed, [clockwise]);
});
