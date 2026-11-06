import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {entranceBearing} from '../tools/building-entrances.mjs';

const cases = JSON.parse(fs.readFileSync('packages/contracts/fixtures/entrance-orientation-cases.json'));

test('wall normals point into buildings, including courtyard walls and either ring winding', () => {
  for (const fixture of cases) {
    const bearing = entranceBearing(fixture.entrance, fixture.polygon);
    const difference = Math.abs((bearing - fixture.bearing + 540) % 360 - 180);
    assert.ok(difference < 0.00001, `${fixture.name}: expected ${fixture.bearing}, got ${bearing}`);
  }
});

test('wall direction is independent of distance to the label anchor and rejects degenerate geometry', () => {
  const square = cases[0].polygon;
  assert.equal(entranceBearing([0.0005, 0.00001], square), 0);
  assert.throws(() => entranceBearing([0, 0], {coordinates: [[[0, 0], [1, 0], [0, 0]]]}), /degenerate ring/);
});
