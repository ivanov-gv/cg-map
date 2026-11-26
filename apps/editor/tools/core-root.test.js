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
  const outputDirectory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'editor-core-'));
  t.after(() => fileSystem.rmSync(outputDirectory, {recursive: true, force: true}));
  const {copyMapCore} = await importCoreModule('tools/assemble.mjs', coreRoot);
  copyMapCore(outputDirectory);
  return fileSystem.readFileSync(path.join(outputDirectory, 'map-core/index.js'), 'utf8');
}

test('dev builds bundle the core of this commit', async t => {
  preserveEnvironment(t);
  assert.notEqual(repositoryCoreRoot, pinnedCoreRoot);
  const coreRoot = resolveCoreRoot();
  assert.equal(coreRoot, repositoryCoreRoot);
  const bundledEntry = await copiedEntry(coreRoot, t);
  assert.equal(bundledEntry, readEntry(repositoryCoreRoot));
  assert.notEqual(bundledEntry, readEntry(pinnedCoreRoot));
});

test('release builds bundle exactly the pinned core', async t => {
  preserveEnvironment(t);
  process.env.MAP_CORE_ROOT = pinnedCoreRoot;
  const coreRoot = resolveCoreRoot({release: true});
  assert.equal(coreRoot, pinnedCoreRoot);
  assert.equal(await copiedEntry(coreRoot, t), readEntry(pinnedCoreRoot));
});

test('a release build refuses any other core root', t => {
  preserveEnvironment(t);
  process.env.MAP_CORE_ROOT = repositoryCoreRoot;
  assert.throws(() => resolveCoreRoot({release: true}), /release build must bundle the pinned/);
  process.env.MAP_CORE_ROOT = '';
  assert.throws(() => resolveCoreRoot({release: true}), /MAP_CORE_ROOT is set but empty/);
});

test('the pin helper resolves the installed release named by this app', () => {
  assert.match(pinnedCoreRoot, /node_modules\/@ivanov-gv\/map-core$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedCoreRoot, 'package.json'), 'utf8'));
  assert.equal(appPackage.dependencies['@ivanov-gv/map-core'], installed.version);
});

test('test targets and the browser suite build from the pinned core', () => {
  const makefile = fileSystem.readFileSync(new URL('../Makefile', import.meta.url), 'utf8');
  assert.match(makefile, /^verify test e2e e2e-built build-release: export MAP_CORE_ROOT = /m);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(appPackage.scripts['pretest:e2e'], /MAP_CORE_ROOT="\$\(node tests\/pinned-core\.mjs\)"/);
  const browserConfig = fileSystem.readFileSync(new URL('../playwright.config.mjs', import.meta.url), 'utf8');
  assert.match(browserConfig, /MAP_CORE_ROOT \?\?= pinnedCoreRoot/);
});

test('a release build marks the build and the build uses the selected core', () => {
  const makefile = fileSystem.readFileSync(new URL('../Makefile', import.meta.url), 'utf8');
  assert.match(makefile, /^build-release:\n\tEDITOR_RELEASE=1 npm run build$/m);
  const buildSource = fileSystem.readFileSync(new URL('./build.mjs', import.meta.url), 'utf8');
  assert.match(buildSource, /importCoreModule\('tools\/assemble\.mjs', coreRoot\)/);
  assert.doesNotMatch(buildSource, /from '@ivanov-gv\/map-core\/tools\/assemble\.mjs'/);
});
