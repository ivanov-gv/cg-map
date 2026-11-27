import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import operatingSystem from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pinnedContractsRoot} from '../tests/pinned-contracts.mjs';
import {pinnedCoreRoot} from '../tests/pinned-core.mjs';
import {pinnedDataRoot} from '../tests/pinned-data.mjs';

const applicationRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = path.resolve(applicationRoot, '..', '..');
const tools = ['build.mjs', 'contracts-root.mjs', 'core-root.mjs', 'data-root.mjs'];
const helpers = ['pinned-contracts.mjs', 'pinned-core.mjs', 'pinned-data.mjs'];

// A throwaway project beside the app's pins: a local core is distinguishable from the core the pins resolve to.
function createFixture(t) {
  const root = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'core-demo-roots-'));
  t.after(() => fileSystem.rmSync(root, {recursive: true, force: true}));
  const app = path.join(root, 'apps/core-demo');
  fileSystem.mkdirSync(path.join(app, 'tools'), {recursive: true});
  fileSystem.mkdirSync(path.join(app, 'tests'), {recursive: true});
  for (const directory of ['public', 'src']) {
    fileSystem.cpSync(path.join(applicationRoot, directory), path.join(app, directory), {recursive: true});
  }
  for (const name of tools) {
    fileSystem.copyFileSync(path.join(applicationRoot, 'tools', name), path.join(app, 'tools', name));
  }
  for (const name of helpers) {
    fileSystem.copyFileSync(path.join(applicationRoot, 'tests', name), path.join(app, 'tests', name));
  }
  fileSystem.copyFileSync(path.join(applicationRoot, 'package.json'), path.join(app, 'package.json'));
  const localCore = path.join(root, 'packages/map-core');
  fileSystem.cpSync(path.join(repositoryRoot, 'packages/map-core'), localCore, {recursive: true});
  fileSystem.symlinkSync(path.join(applicationRoot, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  fileSystem.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const environment = {...process.env, MAP_DATA_ROOT: pinnedDataRoot, MAP_CONTRACTS_ROOT: pinnedContractsRoot};
  delete environment.MAP_CORE_ROOT;
  delete environment.CORE_DEMO_RELEASE;
  return {app, environment, localCore, output: path.join(root, 'dist/core-demo'), root};
}

function runFixtureBuild(fixture, extraEnvironment = {}) {
  return spawnSync(process.execPath, [path.join(fixture.app, 'tools/build.mjs')], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {...fixture.environment, ...extraEnvironment}
  });
}

test('a default build takes map-core from this commit', t => {
  const fixture = createFixture(t);
  fileSystem.appendFileSync(path.join(fixture.localCore, 'src/index.js'), '\nexport const localCoreMarker = true;\n');
  const result = runFixtureBuild(fixture);
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const builtCore = fileSystem.readFileSync(path.join(fixture.output, 'map-core/index.js'), 'utf8');
  assert.match(builtCore, /localCoreMarker/);
});

test('a release build refuses core, data and contracts roots outside its pins', t => {
  const fixture = createFixture(t);
  const pinnedEnvironment = {
    CORE_DEMO_RELEASE: '1',
    MAP_CORE_ROOT: pinnedCoreRoot,
    MAP_DATA_ROOT: pinnedDataRoot,
    MAP_CONTRACTS_ROOT: pinnedContractsRoot
  };
  const rejectedRoots = [
    ['MAP_CORE_ROOT', fixture.localCore, /release build must bundle the pinned @ivanov-gv\/map-core/],
    ['MAP_DATA_ROOT', path.join(fixture.root, 'data'), /release build must bundle the pinned @ivanov-gv\/map-data/],
    [
      'MAP_CONTRACTS_ROOT',
      path.join(fixture.root, 'other-contracts'),
      /release build must bundle the pinned @ivanov-gv\/map-contracts/
    ]
  ];
  for (const [name, value, expectedError] of rejectedRoots) {
    const result = runFixtureBuild(fixture, {...pinnedEnvironment, [name]: value});
    assert.notEqual(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    assert.match(result.stderr, expectedError);
  }
});

test('test targets and the browser suite build from every pin', () => {
  const makefile = fileSystem.readFileSync(path.join(applicationRoot, 'Makefile'), 'utf8');
  assert.match(makefile, /^verify test e2e e2e-built build-release: export MAP_CORE_ROOT = /m);
  assert.match(makefile, /^build-release:\n\tCORE_DEMO_RELEASE=1 npm run build$/m);
  const appPackage = JSON.parse(fileSystem.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'));
  assert.match(appPackage.scripts['pretest:e2e'], /MAP_CORE_ROOT="\$\(node tests\/pinned-core\.mjs\)"/);
  const browserConfig = fileSystem.readFileSync(path.join(applicationRoot, 'playwright.config.mjs'), 'utf8');
  assert.match(browserConfig, /MAP_CORE_ROOT \?\?= pinnedCoreRoot/);
  const buildSource = fileSystem.readFileSync(path.join(applicationRoot, 'tools/build.mjs'), 'utf8');
  assert.match(buildSource, /importCoreModule\('tools\/assemble\.mjs', coreRoot\)/);
  assert.doesNotMatch(buildSource, /from '@ivanov-gv\/map-core\/tools\/assemble\.mjs'/);
});
