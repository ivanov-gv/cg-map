import test from 'node:test';
import assert from 'node:assert/strict';
import {magneticallyMoved, magneticPoint, neighbouringAreas} from '../src/area-magnet.js';
import {doOverlap, overlapNotice} from '../src/area-overlap.js';

// About eight metres east and eleven north.
const step = 0.0001;
const at = (east, north) => [19.25 + east * step, 42.44 + north * step].map(value => Math.round(value * 1e7) / 1e7);
const area = (...steps) => ({type: 'Polygon', coordinates: [[...steps, steps[0]].map(([east, north]) => at(east, north))]});
const square = (east, north, size = 2) =>
  area([east, north], [east + size, north], [east + size, north + size], [east, north + size]);
const entry = (key, geometry, properties = {}) => ({filename: 'buildings.geojson', key, feature: {type: 'Feature', properties, geometry}});
const house = entry('house', square(0, 0));
const reach = 3;

test('a point goes to the nearest corner within reach, otherwise onto the nearest side', () => {
  assert.deepEqual(magneticPoint(at(2.1, 0.1), [house], reach), at(2, 0));
  // The corner is four metres off and the side one.
  assert.deepEqual(magneticPoint(at(2.1, 1), [house], reach), at(2, 1));
  assert.equal(magneticPoint(at(3, 1), [house], reach), null);
  assert.equal(magneticPoint(at(2, 0), [], reach), null);
});

test('a moved area keeps its shape and goes to its neighbour with its closest corner or side', () => {
  const beside = magneticallyMoved(square(2.2, 0.1), [house], reach);
  assert.deepEqual(beside.coordinates[0][0], at(2, 0));
  assert.deepEqual(beside.coordinates[0][2], at(4, 2));
  const alongSide = magneticallyMoved(square(2.1, 0.7, 0.5), [house], reach);
  assert.equal(alongSide.coordinates[0][0][0], at(2, 0)[0]);
  const far = square(9, 9);
  assert.equal(magneticallyMoved(far, [house], reach), far);
});

test('neighbours are the other areas of the file that can be reshaped', () => {
  const rules = {layers: {'buildings.geojson': {geometries: ['Polygon'], operations: ['modify'], properties: {}, editableKinds: ['building']}}};
  const entries = [entry('house', square(0, 0), {kind: 'building'}), entry('frame', square(0, 0), {kind: 'context'}), entry('own', square(1, 1), {kind: 'building'})];
  const found = neighbouringAreas(square(2, 0), {filename: 'buildings.geojson', key: 'own'}, {rules, entriesOf: () => entries}, 1);
  assert.deepEqual(found.map(({key}) => key), ['house']);
});

test('two rules keep their own neighbours for one file', () => {
  const areaRule = {geometries: ['Polygon'], operations: ['modify'], properties: {}, editableKinds: ['building']};
  const lineRule = {...areaRule, geometries: ['LineString']};
  const entries = [entry('house', square(0, 0), {kind: 'building'})];
  const own = {filename: 'buildings.geojson', key: 'own'};
  const ask = rule =>
    neighbouringAreas(square(2, 0), own, {rules: {layers: {'buildings.geojson': rule}}, entriesOf: () => entries}, 1);
  assert.deepEqual(ask(areaRule).map(({key}) => key), ['house']);
  assert.deepEqual(ask(lineRule).map(({key}) => key), []);
});

test('areas that share corners, sides or parts of sides do not overlap', () => {
  for (const neighbour of [square(2, 0), square(2, 1), square(2, 2), square(2, 0.5, 1), square(5, 5)]) {
    assert.equal(doOverlap(house.feature.geometry, neighbour, false), false);
    assert.equal(doOverlap(neighbour, house.feature.geometry, false), false);
  }
  // A centimetre is the rounding of the sources.
  assert.equal(doOverlap(house.feature.geometry, square(1.999, 0), false), false);
});

test('an area that crosses a neighbour overlaps it, also between two good corners', () => {
  const geometry = house.feature.geometry;
  assert.equal(doOverlap(geometry, square(1, 1), false), true);
  assert.equal(doOverlap(geometry, square(0, 0), false), true, 'the same area twice');
  // Both corners lie on sides of the house, and the wall between them crosses it.
  const cutting = area([2, 1], [1, 2], [4, 4]);
  assert.equal(doOverlap(geometry, cutting, false), true);
  assert.equal(doOverlap(geometry, cutting, true), true);
  const across = area([-1, 0.5], [3, 0.5], [3, 1], [-1, 1]);
  assert.equal(doOverlap(geometry, across, true), true);
});

test('an area inside another one overlaps it only where that is not meant, and one in its hole never', () => {
  const inner = square(0.5, 0.5, 1);
  assert.equal(doOverlap(house.feature.geometry, inner, false), true);
  assert.equal(doOverlap(house.feature.geometry, inner, true), false);
  const courtyard = {type: 'Polygon', coordinates: [house.feature.geometry.coordinates[0], inner.coordinates[0]]};
  assert.equal(doOverlap(courtyard, inner, false), false);
});

test('a corner is never magnetised onto a point the shape already has', () => {
  const firstCorner = at(2, 0);
  const nearby = at(2.1, 0.1);
  assert.deepEqual(magneticPoint(nearby, [house], reach), firstCorner);
  assert.notDeepEqual(magneticPoint(nearby, [house], reach, [firstCorner]), firstCorner);
});

test('an emptied area has no outline to pull or to overlap', () => {
  const emptiedRing = {type: 'Polygon', coordinates: [[]]};
  const emptiedShape = {type: 'MultiPolygon', coordinates: []};
  for (const empty of [emptiedRing, emptiedShape]) {
    assert.equal(doOverlap(empty, house.feature.geometry, false), false);
    assert.equal(doOverlap(house.feature.geometry, empty, false), false);
    assert.equal(magneticallyMoved(empty, [house], reach), empty);
  }
});

test('one unfinished part makes a whole MultiPolygon unusable', () => {
  const good = [house.feature.geometry.coordinates[0]];
  for (const bad of [[], [[]], [[at(0, 0)]], [[at(0, 0), at(1, 0)]]]) {
    const broken = {type: 'MultiPolygon', coordinates: [bad, good]};
    assert.equal(doOverlap(broken, house.feature.geometry, false), false);
    assert.equal(doOverlap(house.feature.geometry, broken, false), false);
    assert.equal(magneticallyMoved(broken, [house], reach), broken);
  }
});

test('a side target rounded onto a used point is not used again', () => {
  const used = at(2, 1);
  const target = magneticPoint([19.2502001, 42.44010004], [house], 0.02, [used]);
  assert.notDeepEqual(target, used);
});

test('the overlap notice counts neighbours and names as many as fit', () => {
  const nameOf = ({name}) => name;
  const named = name => ({name});
  assert.equal(overlapNotice([], nameOf), null);
  assert.equal(overlapNotice([named('House')], nameOf), 'Overlaps 1 area: House');
  assert.equal(overlapNotice([named('House'), named('House')], nameOf), 'Overlaps 2 areas: House');
  const five = ['A', 'B', 'C', 'D', 'E'].map(named);
  assert.equal(overlapNotice(five, nameOf), 'Overlaps 5 areas: A, B, C and 2 more');
});
