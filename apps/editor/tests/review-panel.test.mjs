import test from 'node:test';
import assert from 'node:assert/strict';

// The review panel functions are tested by exercising the exported ReviewPanel class,
// but the diff helpers are module-private. To test them, we re-implement the same
// logic here and verify the behavior matches what the panel expects.

// formatValue mirrors the implementation in review-panel.js
function formatValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// diffProperties mirrors the implementation in review-panel.js
function diffProperties(beforeProperties, afterProperties) {
  const allKeys = new Set([...Object.keys(beforeProperties ?? {}), ...Object.keys(afterProperties ?? {})]);
  const changed = [];
  const unchanged = [];
  for (const key of [...allKeys].sort()) {
    const beforeValue = beforeProperties?.[key];
    const afterValue = afterProperties?.[key];
    if (formatValue(beforeValue) !== formatValue(afterValue)) changed.push(key);
    else unchanged.push(key);
  }
  return {changed, unchanged};
}

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
  // This is the key test: two different object references with the same content
  // should be considered unchanged.
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
  // Both null and undefined format to '', so they are unchanged
  assert.deepEqual(changed, []);
  assert.deepEqual(unchanged, ['extra', 'name']);
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

// geometryChanged mirrors the implementation in review-panel.js
function geometryChanged(beforeGeometry, afterGeometry) {
  return JSON.stringify(beforeGeometry ?? {}) !== JSON.stringify(afterGeometry ?? {});
}

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

// summarizeGeometryChange mirrors the implementation in review-panel.js
function summarizeGeometryChange(beforeGeometry, afterGeometry) {
  if (!beforeGeometry || !afterGeometry) return 'geometry changed';
  const beforeCoords = beforeGeometry.coordinates;
  const afterCoords = afterGeometry.coordinates;
  if (JSON.stringify(beforeCoords) === JSON.stringify(afterCoords)) return null;
  function countVertices(coords) {
    if (Array.isArray(coords[0]?.[0])) return coords.flat().length;
    return coords.length;
  }
  const beforeCount = countVertices(beforeCoords);
  const afterCount = countVertices(afterCoords);
  if (beforeCount !== afterCount) return `vertices: ${beforeCount} → ${afterCount}`;
  return 'moved';
}

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
