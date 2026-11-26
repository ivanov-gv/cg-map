import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
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
  const guardFile = path.resolve(fileURLToPath(new URL('tests/pinned-data.test.mjs', applicationRoot)));
  const testFiles = [];
  for (const directory of ['tests', 'src', 'tools']) {
    const root = new URL(`${directory}/`, applicationRoot);
    for (const file of fileSystem.readdirSync(root, {recursive: true})) {
      if (!/\.(?:test|browser\.test)\.(?:js|mjs)$/.test(file) && !file.endsWith('.json')) continue;
      const absolute = path.resolve(fileURLToPath(new URL(`${directory}/${file}`, applicationRoot)));
      if (absolute === guardFile) continue;
      testFiles.push([`${directory}/${file}`, absolute]);
    }
  }
  testFiles.push(['playwright.config.mjs', path.resolve(fileURLToPath(new URL('playwright.config.mjs', applicationRoot)))]);
  for (const [name, file] of testFiles) {
    assert.ok(!repositoryDataPattern.test(fileSystem.readFileSync(file, 'utf8')), `${name}: ${pinnedDataRule}`);
  }
});
