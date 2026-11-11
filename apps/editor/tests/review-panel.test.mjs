import test from 'node:test';
import assert from 'node:assert/strict';
import {diffProperties, formatValue, geometryChanged, summarizeGeometryChange} from '../src/feature-diff.js';

test('diffProperties detects changed scalar values', () => {
  const before = {name: 'Cafe', visibilityLevel: 3};
  const after = {name: 'Restaurant', visibilityLevel: 3};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['name']);
  assert.deepEqual(unchanged, ['visibilityLevel']);
});

test('diffProperties detects added keys', () => {
  const before = {name: 'Cafe'};
  const after = {name: 'Cafe', kind: 'cafe'};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['kind']);
  assert.deepEqual(unchanged, ['name']);
});

test('diffProperties detects removed keys', () => {
  const before = {name: 'Cafe', kind: 'cafe'};
  const after = {name: 'Cafe'};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['kind']);
  assert.deepEqual(unchanged, ['name']);
});

test('diffProperties compares object values by JSON not reference', () => {
  const before = {addr: {city: 'Podgorica'}};
  const after = {addr: {city: 'Podgorica'}};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, []);
  assert.deepEqual(unchanged, ['addr']);
});

test('diffProperties detects changed object values', () => {
  const before = {addr: {city: 'Podgorica'}};
  const after = {addr: {city: 'Titograd'}};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['addr']);
  assert.deepEqual(unchanged, []);
});

test('diffProperties compares array values by JSON not reference', () => {
  const before = {tags: ['food', 'cafe']};
  const after = {tags: ['food', 'cafe']};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, []);
  assert.deepEqual(unchanged, ['tags']);
});

test('diffProperties detects changed array values', () => {
  const before = {tags: ['food', 'cafe']};
  const after = {tags: ['food', 'restaurant']};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['tags']);
  assert.deepEqual(unchanged, []);
});

test('diffProperties handles null and undefined', () => {
  const before = {name: 'Cafe', extra: null};
  const after = {name: 'Cafe', extra: undefined};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['extra']);
  assert.deepEqual(unchanged, ['name']);
});

test('diffProperties handles empty inputs', () => {
  const {changed, unchanged} = diffProperties(null, {});
  assert.deepEqual(changed, []);
  assert.deepEqual(unchanged, []);
});

test('diffProperties sorts keys alphabetically', () => {
  const before = {z: 1, a: 2, m: 3};
  const after = {z: 1, a: 99, m: 3};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['a']);
  assert.deepEqual(unchanged, ['m', 'z']);
});

test('formatValue handles null and undefined', () => {
  assert.equal(formatValue(null), 'null');
  assert.equal(formatValue(undefined), '(missing)');
  assert.equal(formatValue(''), '""');
  assert.equal(formatValue('1'), '"1"');
  assert.equal(formatValue(42), '42');
  assert.equal(formatValue({a: 1}), '{"a":1}');
});

test('geometryChanged detects moved coordinates', () => {
  const before = {type: 'Point', coordinates: [19.25, 42.44]};
  const after = {type: 'Point', coordinates: [19.26, 42.44]};
  assert.equal(geometryChanged(before, after), true);
});

test('geometryChanged returns false for identical geometry', () => {
  const geo = {type: 'Point', coordinates: [19.25, 42.44]};
  assert.equal(geometryChanged(geo, geo), false);
});

test('geometryChanged handles null geometry', () => {
  assert.equal(geometryChanged(null, null), false);
  assert.equal(geometryChanged({type: 'Point', coordinates: [1, 2]}, null), true);
});

test('summarizeGeometryChange returns moved for same vertex count', () => {
  const before = {type: 'Point', coordinates: [19.25, 42.44]};
  const after = {type: 'Point', coordinates: [19.26, 42.44]};
  assert.equal(summarizeGeometryChange(before, after), 'moved');
});

test('summarizeGeometryChange returns vertex count change', () => {
  const before = {type: 'LineString', coordinates: [[1, 2], [3, 4]]};
  const after = {type: 'LineString', coordinates: [[1, 2], [2, 3], [3, 4]]};
  assert.equal(summarizeGeometryChange(before, after), 'vertices: 2 → 3');
});

test('summarizeGeometryChange returns null for unchanged coordinates', () => {
  const geo = {type: 'Point', coordinates: [19.25, 42.44]};
  assert.equal(summarizeGeometryChange(geo, geo), null);
});

test('summarizeGeometryChange handles null geometry', () => {
  assert.equal(summarizeGeometryChange(null, {type: 'Point', coordinates: [1, 2]}), 'geometry changed');
});


test('summarizeGeometryChange counts vertices across multipolygon rings', () => {
  const before = {type: 'MultiPolygon', coordinates: [[[[1, 2], [3, 4], [1, 2]]]]};
  const after = {type: 'MultiPolygon', coordinates: [[[[1, 2], [2, 3], [3, 4], [1, 2]]]]};
  assert.equal(summarizeGeometryChange(before, after), 'vertices: 3 → 4');
});


test('diffProperties distinguishes types and missing keys from empty values', () => {
  const before = {count: 1, enabled: true, removed: null};
  const after = {count: '1', enabled: 'true', added: ''};
  const {changed, unchanged} = diffProperties(before, after);
  assert.deepEqual(changed, ['added', 'count', 'enabled', 'removed']);
  assert.deepEqual(unchanged, []);
});
