import test from 'node:test';
import assert from 'node:assert/strict';
import {TILE_LAYERS} from '../tools/tile-layers.mjs';

test('railway tiles carry English names and station references', () => {
  const railways = TILE_LAYERS.find(({name}) => name === 'railways');
  const missingFields = ['name:en', 'ref'].filter(
    field => !railways.fields.includes(field)
  );
  assert.deepEqual(missingFields, [], 'railways must publish name:en and ref');
});
