import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {repositoryContractsRoot, resolveContractsRoot} from '../tools/contracts-root.mjs';
import {pinnedContractsRoot} from './pinned-contracts.mjs';

function preserveEnvironment(t) {
  const previous = process.env.MAP_CONTRACTS_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.MAP_CONTRACTS_ROOT;
    else process.env.MAP_CONTRACTS_ROOT = previous;
  });
  delete process.env.MAP_CONTRACTS_ROOT;
}

test('dev builds resolve repository contracts and test targets can override the root', t => {
  preserveEnvironment(t);
  assert.equal(resolveContractsRoot(), repositoryContractsRoot);
  assert.ok(fileSystem.existsSync(path.join(repositoryContractsRoot, 'editor-bundle.schema.json')));
  process.env.MAP_CONTRACTS_ROOT = '/candidate/contracts';
  assert.equal(resolveContractsRoot(), '/candidate/contracts');
});

test('an empty contract root is a configuration error', t => {
  preserveEnvironment(t);
  process.env.MAP_CONTRACTS_ROOT = '';
  assert.throws(() => resolveContractsRoot(), /MAP_CONTRACTS_ROOT is set but empty/);
});

test('editor tests read contracts from the app pin', () => {
  assert.match(pinnedContractsRoot, /node_modules\/@ivanov-gv\/map-contracts$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedContractsRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-contracts'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
});

test('the browser config defaults to the pinned contracts root', () => {
  const browserConfig = fileSystem.readFileSync(new URL('../playwright.config.mjs', import.meta.url), 'utf8');
  assert.match(browserConfig, /MAP_CONTRACTS_ROOT \?\?= pinnedContractsRoot/);
});
