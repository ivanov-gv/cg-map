import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryAreaSquareMetres} from '../src/geometry-measures.js';
import {sidesOfRidge, slidEnd, slopesWithSlidEnds} from '../src/ridge-ends.js';

const step = 0.0001;
const at = ([east, north]) => [19 + east * step, 42 + north * step].map(value => Math.round(value * 1e7) / 1e7);
const points = (...steps) => steps.map(at);
const stepsOf = ([longitude, latitude]) => [longitude - 19, latitude - 42].map(value => Math.round((value / step) * 100) / 100);
const slope = (key, aspect, ...corners) => ({
  filename: 'slopes.geojson',
  key,
  feature: {
    type: 'Feature',
    properties: {aspect},
    geometry: {type: 'Polygon', coordinates: [[...points(...corners), at(corners[0])]]}
  }
});
// A square hill whose ridge runs from west to east.
const ridge = points([0, 5], [5, 5], [10, 5]);
const sunlit = slope('sunlit', 'sunlit', [0, 0], [10, 0], [10, 5], [5, 5], [0, 5]);
const shaded = slope('shaded', 'shaded', [0, 5], [5, 5], [10, 5], [10, 10], [0, 10]);
const sides = sidesOfRidge(ridge, [sunlit, shaded, slope('other', 'sunlit', [20, 0], [30, 0], [30, 5])], 60);
const areaOf = geometry => geometryAreaSquareMetres(geometry);
const totalArea = [sunlit, shaded].reduce((area, {feature}) => area + areaOf(feature.geometry), 0);

test('the sides of a ridge are the two slopes that run along it, and a closed ridge has none', () => {
  assert.deepEqual(sides.map(({entry}) => entry.key).sort(), ['shaded', 'sunlit']);
  assert.equal(sidesOfRidge([...ridge, ridge[0]], [sunlit, shaded], 60), null);
});

test('a dragged end goes to the nearest place of the outline, and never onto the other end', () => {
  assert.deepEqual(stepsOf(slidEnd(at([-2, 7]), ridge.at(-1), sides)), [0, 7]);
  assert.deepEqual(stepsOf(slidEnd(at([4, 11]), ridge.at(-1), sides)), [4, 10]);
  assert.equal(slidEnd(at([10.5, 5]), ridge.at(-1), sides), null);
});

for (const [name, line] of [
  ['the start slides up', points([0, 7], [5, 5], [10, 5])],
  ['the start slides down around a corner', points([2, 0], [5, 5], [10, 5])],
  ['the end slides up around a corner', points([0, 5], [5, 5], [6, 10])],
  ['both ends slide', points([0, 8], [5, 5], [10, 1])]
]) {
  test(`what an end passes goes from one side to the other: ${name}`, () => {
    const edits = slopesWithSlidEnds(line, sides);
    const areas = edits.map(({after}) => areaOf(after.geometry));
    assert.ok(Math.abs(areas[0] + areas[1] - totalArea) < totalArea / 1000, 'the hill stays whole');
    for (const {after} of edits) {
      const [ring] = after.geometry.coordinates;
      assert.deepEqual(ring[0], ring.at(-1));
      for (const point of line) assert.ok(ring.some(corner => String(corner) === String(point)), `${stepsOf(point)}`);
    }
  });
}

test('the side that loses ground no longer has the old end', () => {
  const [first] = slopesWithSlidEnds(points([0, 7], [5, 5], [10, 5]), sides).filter(({key}) => key === 'shaded');
  const corners = first.after.geometry.coordinates[0].map(point => String(stepsOf(point)));
  assert.ok(!corners.includes('0,5') && corners.includes('0,7') && corners.includes('0,10'));
});
