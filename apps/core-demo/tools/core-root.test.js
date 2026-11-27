import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import operatingSystem from 'node:os';
import path from 'node:path';
import {importCoreModule, repositoryCoreRoot, resolveCoreRoot} from './core-root.mjs';
import {pinnedCoreRoot} from '../tests/pinned-core.mjs';

function preserveEnvironment(t) {
  const previous = process.env.MAP_CORE_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.MAP_CORE_ROOT;
    else process.env.MAP_CORE_ROOT = previous;
  });
  delete process.env.MAP_CORE_ROOT;
}

function readEntry(root) {
  return fileSystem.readFileSync(path.join(root, 'src/index.js'), 'utf8');
}

async function copiedEntry(coreRoot, t) {
  const outputDirectory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'core-demo-core-'));
  t.after(() => fileSystem.rmSync(outputDirectory, {recursive: true, force: true}));
  const {copyMapCore} = await importCoreModule('tools/assemble.mjs', coreRoot);
  copyMapCore(outputDirectory);
  return fileSystem.readFileSync(path.join(outputDirectory, 'map-core/index.js'), 'utf8');
}

test('dev builds select the core root of this commit', t => {
  preserveEnvironment(t);
  assert.equal(resolveCoreRoot(), repositoryCoreRoot);
});

test('release builds bundle exactly the pinned core', async t => {
  preserveEnvironment(t);
  process.env.MAP_CORE_ROOT = pinnedCoreRoot;
  const coreRoot = resolveCoreRoot({release: true});
  assert.equal(coreRoot, pinnedCoreRoot);
  assert.equal(await copiedEntry(coreRoot, t), readEntry(pinnedCoreRoot));
});

test('a release build refuses any core root other than its pin', t => {
  preserveEnvironment(t);
  process.env.MAP_CORE_ROOT = path.join(operatingSystem.tmpdir(), 'other-core');
  assert.throws(() => resolveCoreRoot({release: true}), /release build must bundle the pinned/);
  delete process.env.MAP_CORE_ROOT;
  assert.throws(() => resolveCoreRoot({release: true}), /A release build must set MAP_CORE_ROOT/);
  process.env.MAP_CORE_ROOT = '';
  assert.throws(() => resolveCoreRoot({release: true}), /MAP_CORE_ROOT is set but empty/);
});

test('the pin helper resolves the workspace version named by this app', () => {
  assert.equal(pinnedCoreRoot, repositoryCoreRoot);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedCoreRoot, 'package.json'), 'utf8'));
  assert.equal(appPackage.dependencies['@ivanov-gv/map-core'], '0.0.0-dev');
  assert.equal(installed.version, '0.0.0-dev');
});
