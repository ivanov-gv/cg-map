import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {categories} from '../../apps/web/src/core.js';

test('web categories agree with the published place contract', () => {
  const contract = JSON.parse(fs.readFileSync('packages/contracts/places.schema.json'));
  assert.deepEqual(Object.keys(categories).filter(key => key !== 'all').sort(), contract.properties.properties.properties.category.enum.slice().sort());
});
