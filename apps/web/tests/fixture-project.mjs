// A throwaway Web project under the OS temp directory. It uses the app's own tools and installed pins, so a probe can
// add nested modules without touching this checkout's sources, its built artifact, or another component's files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pinnedContractsRoot} from './pinned-contracts.mjs';
import {pinnedDataRoot} from './pinned-data.mjs';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

// Returns an isolated project with one nested runtime module, two colocated tests, and a support helper.
export function createFixtureProject(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-web-fixture-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const app = path.join(root, 'apps/web');
  const source = path.join(app, 'src');
  fs.mkdirSync(path.join(source, 'feature'), {recursive: true});
  fs.mkdirSync(path.join(source, 'test-support'), {recursive: true});
  fs.mkdirSync(path.join(app, 'tools'), {recursive: true});
  fs.cpSync(path.join(appRoot, 'tools'), path.join(app, 'tools'), {recursive: true});
  fs.cpSync(path.join(appRoot, 'public'), path.join(app, 'public'), {recursive: true});
  fs.copyFileSync(path.join(appRoot, 'package.json'), path.join(app, 'package.json'));
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(appRoot, 'src/sw.js'), path.join(source, 'sw.js'));
  fs.writeFileSync(path.join(source, 'app.js'), "import {featureValue} from './feature/nested.js';\nexport {featureValue};\n");
  fs.writeFileSync(path.join(source, 'sw.js'), "self.addEventListener('install', () => {});\n");
  fs.writeFileSync(path.join(source, 'feature/nested.js'), "import '@ivanov-gv/map-core';\nexport const featureValue = 1;\n");
  fs.writeFileSync(path.join(source, 'feature/nested.test.js'), "import '../../../../editor/src/core.js';\n");
  fs.writeFileSync(path.join(source, 'feature/nested.browser.test.js'), "import '../../../../editor/src/core.js';\n");
  fs.writeFileSync(path.join(source, 'test-support/helper.js'), 'export const helper = true;\n');
  return {
    root,
    app,
    source,
    tools: path.join(app, 'tools'),
    output: path.join(root, 'dist/web'),
    environment: {...process.env, MAP_DATA_ROOT: pinnedDataRoot, MAP_CONTRACTS_ROOT: pinnedContractsRoot}
  };
}

export function runFixtureTool(fixture, toolName, args = []) {
  return spawnSync(process.execPath, [path.join(fixture.tools, toolName), ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: fixture.environment
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
