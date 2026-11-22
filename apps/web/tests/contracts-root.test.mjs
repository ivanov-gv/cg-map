import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveContractsRoot} from '../tools/contracts-root.mjs';

function preserveEnvironment(t) {
  const previous = process.env.MAP_CONTRACTS_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.MAP_CONTRACTS_ROOT;
    else process.env.MAP_CONTRACTS_ROOT = previous;
  });
  delete process.env.MAP_CONTRACTS_ROOT;
}

test('contract root defaults to the pinned package and honours a release override', t => {
  preserveEnvironment(t);
  assert.equal(resolveContractsRoot('/default/contracts'), '/default/contracts');
  process.env.MAP_CONTRACTS_ROOT = '/candidate/contracts';
  assert.equal(resolveContractsRoot('/default/contracts'), '/candidate/contracts');
});

test('an empty contract root is a configuration error', t => {
  preserveEnvironment(t);
  process.env.MAP_CONTRACTS_ROOT = '';
  assert.throws(() => resolveContractsRoot('/default/contracts'), /MAP_CONTRACTS_ROOT is set but empty/);
});
