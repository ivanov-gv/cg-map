import test from 'node:test';
import assert from 'node:assert/strict';
import operatingSystem from 'node:os';
import path from 'node:path';
import {resolveDataRoot} from './data-root.mjs';
import {pinnedDataRoot} from '../tests/pinned-data.mjs';

function preserveEnvironment(t) {
  const previous = process.env.MAP_DATA_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.MAP_DATA_ROOT;
    else process.env.MAP_DATA_ROOT = previous;
  });
  delete process.env.MAP_DATA_ROOT;
}

test('dev builds keep the repository data root', t => {
  preserveEnvironment(t);
  const repositoryRoot = path.join(operatingSystem.tmpdir(), 'repository-data');
  assert.equal(resolveDataRoot(repositoryRoot), repositoryRoot);
});

test('test targets and release builds read only the pinned data', t => {
  preserveEnvironment(t);
  process.env.MAP_DATA_ROOT = pinnedDataRoot;
  assert.equal(resolveDataRoot(path.join(operatingSystem.tmpdir(), 'repository-data'), {release: true}), pinnedDataRoot);
  process.env.MAP_DATA_ROOT = path.join(operatingSystem.tmpdir(), 'other-data');
  assert.throws(
    () => resolveDataRoot(path.join(operatingSystem.tmpdir(), 'repository-data'), {release: true}),
    /release build must bundle the pinned @ivanov-gv\/map-data/
  );
});

test('an empty data root is a configuration error', t => {
  preserveEnvironment(t);
  process.env.MAP_DATA_ROOT = '';
  assert.throws(() => resolveDataRoot(pinnedDataRoot), /MAP_DATA_ROOT is set but empty/);
});
