// A throwaway Web project under the OS temp directory. It uses the app's own tools and installed pins, so a probe can
// add nested modules without touching this checkout's sources, its built artifact, or another component's files. Its
// node_modules link points at apps/web/node_modules: the repository root would resolve the map-core workspace HEAD
// instead of this app's published 0.2.0 pin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mainRuntimeModules} from '../tools/runtime-modules.mjs';
import {pinnedContractsRoot} from './pinned-contracts.mjs';
import {pinnedCoreRoot} from './pinned-core.mjs';
import {pinnedDataRoot} from './pinned-data.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));

// Returns an isolated project with main's reviewed modules in their feature folders, a nested runtime module, a local
// map-core sibling path, two colocated tests, and a support helper.
export function createFixtureProject(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-web-fixture-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const app = path.join(root, 'apps/web');
  const source = path.join(app, 'src');
  fs.mkdirSync(path.join(source, 'shared/feature/map-core'), {recursive: true});
  fs.mkdirSync(path.join(source, 'test-support'), {recursive: true});
  fs.cpSync(pinnedCoreRoot, path.join(root, 'packages/map-core'), {recursive: true});
  fs.mkdirSync(path.join(app, 'tools'), {recursive: true});
  fs.mkdirSync(path.join(app, 'tests'), {recursive: true});
  fs.cpSync(path.join(appRoot, 'tools'), path.join(app, 'tools'), {recursive: true});
  fs.cpSync(path.join(appRoot, 'public'), path.join(app, 'public'), {recursive: true});
  fs.copyFileSync(path.join(appRoot, 'package.json'), path.join(app, 'package.json'));
  // The copied tools resolve their own pins, not the checkout's, so a fixture probe stays isolated.
  for (const helper of ['pinned-core.mjs', 'pinned-contracts.mjs', 'pinned-data.mjs'])
    fs.copyFileSync(path.join(appRoot, 'tests', helper), path.join(app, 'tests', helper));
  fs.symlinkSync(path.join(appRoot, 'node_modules'), path.join(app, 'node_modules'), 'dir');
  // Contracts are installed at the repository root, while core and data are installed beside this app.
  if (!fs.existsSync(path.join(root, 'node_modules')))
    fs.symlinkSync(path.join(appRoot, '../../node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.writeFileSync(path.join(source, 'app.js'), "import {featureValue} from './shared/feature/nested.js';\nexport {featureValue};\n");
  fs.writeFileSync(path.join(source, 'sw.js'), "self.addEventListener('install', () => {});\n");
  for (const moduleName of mainRuntimeModules) {
    if (moduleName === 'app.js') continue;
    const destination = path.join(source, moduleName);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, 'export {};\n');
  }
  fs.writeFileSync(
    path.join(source, 'shared/feature/nested.js'),
    [
      "import '@ivanov-gv/map-core';",
      "import {localHelper} from './map-core/helper.js';",
      'export const featureValue = 1;',
      "export const localIconPath = './map-core/icon.svg';",
      'export {localHelper};',
      ''
    ].join('\n')
  );
  fs.writeFileSync(path.join(source, 'shared/feature/map-core/helper.js'), "export const localHelper = 'feature-local';\n");
  fs.writeFileSync(path.join(source, 'shared/feature/map-core/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  fs.writeFileSync(path.join(source, 'shared/feature/nested.test.js'), "import '../../../../../editor/src/core.js';\n");
  fs.writeFileSync(path.join(source, 'shared/feature/nested.browser.test.js'), "import '../../../../../editor/src/core.js';\n");
  fs.writeFileSync(path.join(source, 'test-support/helper.js'), 'export const helper = true;\n');
  const environment = {...process.env, MAP_DATA_ROOT: pinnedDataRoot, MAP_CONTRACTS_ROOT: pinnedContractsRoot};
  // A fixture build chooses its own core and is never a release unless a caller says so.
  delete environment.MAP_CORE_ROOT;
  delete environment.WEB_RELEASE;
  return {
    root,
    app,
    source,
    localCore: path.join(root, 'packages/map-core'),
    tools: path.join(app, 'tools'),
    output: path.join(root, 'dist/web'),
    environment
  };
}

export function runFixtureTool(fixture, toolName, args = [], extraEnvironment = {}) {
  return spawnSync(process.execPath, [path.join(fixture.tools, toolName), ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {...fixture.environment, ...extraEnvironment}
  });
}

export function buildFixture(fixture) {
  const result = runFixtureTool(fixture, 'build.mjs');
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
}

export function finalizeFixture(fixture, args = []) {
  const result = runFixtureTool(fixture, 'finalize.mjs', args);
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
}

export function readFixtureManifest(fixture) {
  return JSON.parse(fs.readFileSync(path.join(fixture.output, 'data/manifest.json'), 'utf8'));
}
