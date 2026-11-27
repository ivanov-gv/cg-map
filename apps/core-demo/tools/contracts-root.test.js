import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {repositoryContractsRoot, resolveContractsRoot} from './contracts-root.mjs';
import {pinnedContractsRoot} from '../tests/pinned-contracts.mjs';

function preserveEnvironment(t) {
  const previous = process.env.MAP_CONTRACTS_ROOT;
  const previousRelease = process.env.CORE_DEMO_RELEASE;
  t.after(() => {
    if (previous === undefined) delete process.env.MAP_CONTRACTS_ROOT;
    else process.env.MAP_CONTRACTS_ROOT = previous;
    if (previousRelease === undefined) delete process.env.CORE_DEMO_RELEASE;
    else process.env.CORE_DEMO_RELEASE = previousRelease;
  });
  delete process.env.MAP_CONTRACTS_ROOT;
  delete process.env.CORE_DEMO_RELEASE;
}

test('dev builds resolve repository contracts and test targets can override the root', t => {
  preserveEnvironment(t);
  assert.equal(resolveContractsRoot(), repositoryContractsRoot);
  assert.ok(fileSystem.existsSync(path.join(repositoryContractsRoot, 'place-visibility.json')));
  process.env.MAP_CONTRACTS_ROOT = '/candidate/contracts';
  assert.equal(resolveContractsRoot(), '/candidate/contracts');
});

test('an empty contract root is a configuration error', t => {
  preserveEnvironment(t);
  process.env.MAP_CONTRACTS_ROOT = '';
  assert.throws(() => resolveContractsRoot(), /MAP_CONTRACTS_ROOT is set but empty/);
});

test('a release build reads only the pinned contracts', t => {
  preserveEnvironment(t);
  process.env.CORE_DEMO_RELEASE = '1';
  process.env.MAP_CONTRACTS_ROOT = pinnedContractsRoot;
  assert.equal(resolveContractsRoot(), pinnedContractsRoot);
  process.env.MAP_CONTRACTS_ROOT = repositoryContractsRoot;
  assert.throws(
    () => resolveContractsRoot(),
    /release build must bundle the pinned @ivanov-gv\/map-contracts/
  );
});

test('core-demo tests read contracts from the app pin', () => {
  assert.match(pinnedContractsRoot, /node_modules\/@ivanov-gv\/map-contracts$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedContractsRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-contracts'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
});
