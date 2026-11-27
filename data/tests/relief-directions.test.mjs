import test from 'node:test';
import assert from 'node:assert/strict';
import {reversedCanyonRims, reversedClosedContours} from '../tools/relief-directions.mjs';

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

// A drawn rim names no river, so no centreline can judge it
test('a drawn rim without a river is not judged for direction', () => {
  const water = collection([]);
  const drawn = line([[19.002, 42.0003], [19.008, 42.0003]], {method: 'editor-drawn'});
  assert.deepEqual(reversedCanyonRims(collection([drawn]), water), []);
});

// Around a hill, rings run counter-clockwise; around a hollow, clockwise. The innermost ring is judged by its summit.
test('closed contours with higher ground on their right are reported', () => {
  const square = size => [[19 - size, 42 - size], [19 + size, 42 - size], [19 + size, 42 + size], [19 - size, 42 + size], [19 - size, 42 - size]];
  const ring = (size, elevation, isClockwise) =>
    line(isClockwise ? [...square(size)].reverse() : square(size), {elevation});
  const hillFoot = ring(0.03, 100, false);
  const hillMiddle = ring(0.02, 120, true);
  const hillTop = ring(0.01, 140, false);
  const summit = {type: 'Feature', properties: {enclosingContourElevation: 140}, geometry: {type: 'Point', coordinates: [19, 42]}};
  const result = reversedClosedContours(collection([hillFoot, hillMiddle, hillTop]), collection([summit]));
  assert.equal(result.judgedCount, 3);
  assert.deepEqual(result.reversed, [hillMiddle]);
});
