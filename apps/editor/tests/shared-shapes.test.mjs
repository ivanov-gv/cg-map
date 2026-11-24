import test from 'node:test';
import assert from 'node:assert/strict';
import {changedStretch, followingEdits, splicedLine, splicedRing} from '../src/shared-shapes.js';
import {flowsInto, linesKeepingJoins, riverEndingOnShores, riversKeepingShore} from '../src/water-joins.js';

const step = 0.001;
const at = ([east, north]) => [19 + east * step, 42 + north * step];
const points = (...steps) => steps.map(at);
const stepsOf = coordinates => coordinates.map(([longitude, latitude]) => [longitude - 19, latitude - 42].map(value => Math.round((value / step) * 1000) / 1000));
const toleranceMetres = 20;

test('a changed stretch reaches from the point that stayed before it to the one after it', () => {
  const before = points([0, 0], [1, 0], [2, 0], [3, 0]);
  const after = points([0, 0], [1, 0], [2, 1], [3, 0]);
  const stretch = changedStretch(before, after);
  assert.deepEqual(stepsOf(stretch.before), [[1, 0], [2, 0], [3, 0]]);
  assert.deepEqual(stepsOf(stretch.after), [[1, 0], [2, 1], [3, 0]]);
  assert.equal(changedStretch(before, before), null);
  const inserted = changedStretch(before, points([0, 0], [1, 0], [1.5, 1], [2, 0], [3, 0]));
  assert.deepEqual(stepsOf(inserted.before), [[1, 0], [2, 0]]);
  const movedEnd = changedStretch(before, points([0, 1], [1, 0], [2, 0], [3, 0]));
  assert.deepEqual(stepsOf(movedEnd.before), [[0, 0], [1, 0]]);
});

const stretch = {before: points([0, 0], [1, 0], [2, 0]), after: points([0, 0], [1, 1], [2, 0])};
const ringOf = (...steps) => points(...steps, steps[0]);

for (const [name, ring, expected] of [
  ['runs along it', ringOf([0, 0], [1, 0], [2, 0], [2, 3], [0, 3]), [[0, 0], [1, 1], [2, 0], [2, 3], [0, 3], [0, 0]]],
  ['runs against it', ringOf([0, 3], [2, 3], [2, 0], [1, 0], [0, 0]), [[2, 0], [1, 1], [0, 0], [0, 3], [2, 3], [2, 0]]],
  ['starts in its middle', ringOf([1, 0], [2, 0], [2, 3], [0, 3], [0, 0]), [[0, 0], [1, 1], [2, 0], [2, 3], [0, 3], [0, 0]]],
  ['has no point of its own in the middle', ringOf([0, 0], [2, 0], [2, -3], [0, -3]), [[0, 0], [1, 1], [2, 0], [2, -3], [0, -3], [0, 0]]]
]) {
  test(`an outline that ${name} follows the line`, () => {
    const spliced = stepsOf(splicedRing(ring, stretch, toleranceMetres));
    assert.deepEqual(spliced[0], spliced.at(-1), 'the ring stays closed');
    // A ring may start at any of its corners.
    assert.deepEqual(spliced.slice(1).sort(), expected.slice(1).sort());
  });
}

test('an outline simplified apart from the line follows it, and keeps its own corners elsewhere', () => {
  // One long side runs along the whole stretch, with no corner near either end of it.
  const simplified = ringOf([-5, 0.1], [7, 0.1], [7, 5], [-5, 5]);
  const spliced = stepsOf(splicedRing(simplified, stretch, toleranceMetres));
  for (const corner of [[-5, 0.1], [7, 0.1], [7, 5], [-5, 5], [1, 1]]) {
    assert.ok(spliced.some(point => String(point) === String(corner)), `${corner} is kept`);
  }
  // It meets the line beside its ends, so the long side does not turn.
  assert.ok(spliced.some(point => String(point) === String([0, 0.1])));
  assert.ok(spliced.some(point => String(point) === String([2, 0.1])));
});

test('of two outlines near a short stretch only its own follows', () => {
  const border = (key, coordinates) => ({
    filename: 'border-edges.geojson',
    key,
    feature: {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}}
  });
  const edits = followingEdits(
    [border('near', points([0, 0.1], [2, 0.1])), border('own', points([0, 0], [1, 0], [2, 0]))],
    stretch,
    toleranceMetres
  );
  assert.deepEqual(edits.map(({key}) => key), ['own']);
});

test('an outline elsewhere, or one that only meets the ends of the line, does not follow it', () => {
  assert.equal(splicedRing(ringOf([5, 0], [6, 0], [6, 1]), stretch, toleranceMetres), null);
  const aroundTheOtherWay = ringOf([0, 0], [0, -2], [2, -2], [2, 0], [4, 4]);
  assert.equal(splicedRing(aroundTheOtherWay, stretch, toleranceMetres), null);
  assert.equal(splicedLine(points([0, 0], [0, 1]), stretch, toleranceMetres), null);
});

test('an island follows its own closed shore, and both sides of a shared line change in one set of edits', () => {
  const island = ringOf([0, 0], [1, 0], [1, 1]);
  const moved = ringOf([0, 0], [2, 0], [1, 1]);
  assert.deepEqual(stepsOf(splicedRing(island, {before: island, after: moved}, toleranceMetres)), stepsOf(moved));
  const entry = (key, coordinates) => ({
    filename: 'municipalities.geojson',
    key,
    feature: {type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates}}
  });
  const edits = followingEdits(
    [
      entry('0', [ringOf([0, 0], [1, 0], [2, 0], [2, 3], [0, 3])]),
      entry('1', [ringOf([0, 0], [0, -3], [2, -3], [2, 0], [1, 0])]),
      entry('2', [ringOf([7, 7], [8, 7], [8, 8])])
    ],
    stretch,
    toleranceMetres
  );
  assert.deepEqual(edits.map(({key}) => key), ['0', '1']);
  for (const {after} of edits) {
    assert.ok(stepsOf(after.geometry.coordinates[0]).some(([east, north]) => east === 1 && north === 1));
  }
});

const waterLine = (key, ...steps) => ({
  filename: 'water.geojson',
  key,
  feature: {type: 'Feature', properties: {kind: 'stream', name: key}, geometry: {type: 'LineString', coordinates: points(...steps)}}
});
const lake = {
  filename: 'water.geojson',
  key: 'lake',
  feature: {
    type: 'Feature',
    properties: {kind: 'lake', name: 'Lake'},
    geometry: {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 4], [0, 4])]}
  }
};

test('rivers keep their joins with each other and with a shore when either side moves', () => {
  const tributary = waterLine('tributary', [2, 8], [2, 6]);
  const river = waterLine('river', [2, 10], [2, 6], [2, 4]);
  const entries = [tributary, river, lake];
  const movedRiver = {...river.feature.geometry, coordinates: points([2, 10], [3, 6], [2, 4])};
  const [joined] = linesKeepingJoins('river', river.feature.geometry, movedRiver, entries);
  assert.deepEqual(stepsOf(joined.after.geometry.coordinates), [[2, 8], [3, 6]]);

  // The same joint, with a point added beside it in one edit, and with the joint taken away.
  const withMore = {...river.feature.geometry, coordinates: points([2, 10], [2, 8.5], [3, 6], [2, 4])};
  const [joinedAgain] = linesKeepingJoins('river', river.feature.geometry, withMore, entries);
  assert.deepEqual(stepsOf(joinedAgain.after.geometry.coordinates).at(-1), [3, 6]);
  const withoutJoint = {...river.feature.geometry, coordinates: points([2, 10], [2, 4])};
  const [joinedToNearest] = linesKeepingJoins('river', river.feature.geometry, withoutJoint, entries);
  assert.deepEqual(stepsOf(joinedToNearest.after.geometry.coordinates).at(-1), [2, 4]);

  const smallerLake = {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 3], [0, 3])]};
  const [shortened] = riversKeepingShore(lake.feature.geometry, smallerLake, entries);
  assert.equal(shortened.key, 'river');
  assert.deepEqual(stepsOf(shortened.after.geometry.coordinates).at(-1), [2, 3]);

  const dragged = {...river.feature.geometry, coordinates: points([2, 10], [2, 6], [3, 4.5])};
  const kept = riverEndingOnShores(river.feature.geometry, dragged, entries);
  assert.deepEqual(stepsOf(kept.coordinates).at(-1), [3, 4]);

  const reversed = {...river.feature.geometry, coordinates: river.feature.geometry.coordinates.toReversed()};
  assert.deepEqual(riverEndingOnShores(river.feature.geometry, reversed, entries), reversed, 'a reversal moves nothing');
  assert.deepEqual(linesKeepingJoins('river', river.feature.geometry, reversed, entries), []);

  assert.equal(flowsInto(river, entries).key, 'lake');
  assert.equal(flowsInto(tributary, entries).key, 'river');
  assert.equal(flowsInto(waterLine('alone', [9, 9], [9, 8]), entries), undefined);
});
