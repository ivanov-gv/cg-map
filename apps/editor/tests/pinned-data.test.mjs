import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pinnedDataRoot, readPinnedSource} from './pinned-data.mjs';

const applicationRoot = new URL('..', import.meta.url);
const pinnedDataRule = 'editor tests must read data and data tools from the pinned @ivanov-gv/map-data package, not the repository data folder';
const repositoryDataPattern = new RegExp(
  [
    '(?:\\.\\./)+data(?:/|[\'"`])',
    '(?<!map-)data/(?:sources|tools|artifacts|imagery)\\b',
    '(?:join|resolve)\\s*\\([^)]*[\'"]data[\'"]\\s*,\\s*[\'"](?:sources|tools|artifacts|imagery)[\'"]'
  ].join('|')
);

test('editor tests read sources from the pinned package', () => {
  assert.match(pinnedDataRoot, /node_modules\/@ivanov-gv\/map-data$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedDataRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-data'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
  const places = JSON.parse(readPinnedSource('places.geojson'));
  assert.ok(places.features.length > 0);
});

test('editor tests and the browser config never read repository data', () => {
  // This file holds the rule's text, so it cannot also be subject to it.
  const guardFile = 'pinned-data.test.mjs';
  const testFiles = fileSystem.readdirSync(new URL('tests/', applicationRoot), {recursive: true})
    .filter(file => file !== guardFile && /\.(?:mjs|js|json)$/.test(file))
    .map(file => [file, new URL(`tests/${file}`, applicationRoot)]);
  testFiles.push(['playwright.config.mjs', new URL('playwright.config.mjs', applicationRoot)]);
  for (const [name, file] of testFiles) {
    assert.ok(!repositoryDataPattern.test(fileSystem.readFileSync(file, 'utf8')), `${name}: ${pinnedDataRule}`);
  }
});

test('the editor guard rejects a repository data path in a test', t => {
  const probeName = `__data-probe-${process.pid}.mjs`;
  const probe = new URL(`tests/${probeName}`, applicationRoot);
  t.after(() => fileSystem.rmSync(probe, {force: true}));
  fileSystem.writeFileSync(probe, "export const source = '../../../../data/sources/places.geojson';\n");
  const childEnvironment = {...process.env};
  for (const name of Object.keys(childEnvironment).filter(name => name.startsWith('NODE_TEST'))) {
    delete childEnvironment[name];
  }
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-name-pattern=never read repository data', fileURLToPath(new URL(import.meta.url))],
    {cwd: fileURLToPath(applicationRoot), encoding: 'utf8', env: childEnvironment}
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.notEqual(result.status, 0, output);
  assert.ok(output.includes(probeName), output);
});
