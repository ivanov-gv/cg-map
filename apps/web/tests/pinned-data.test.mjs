import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {pinnedDataRoot, readPinnedSource, readPinnedFixture} from './pinned-data.mjs';

const applicationRoot = new URL('..', import.meta.url);
const pinnedDataRule = 'web tests must read data and data tools from the pinned @ivanov-gv/map-data package, not the repository data folder';
const repositoryDataPattern = new RegExp(
  [
    '(?:\\.\\./)+data(?:/|[\'"`])',
    '(?<!map-)data/(?:sources|tools|artifacts|imagery)\\b',
    '(?:join|resolve)\\s*\\([^)]*[\'"]data[\'"]\\s*,\\s*[\'"](?:sources|tools|artifacts|imagery)[\'"]'
  ].join('|')
);

test('web tests read sources and fixtures from the pinned package', () => {
  assert.match(pinnedDataRoot, /node_modules\/@ivanov-gv\/map-data$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedDataRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-data'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
  const labels = JSON.parse(readPinnedSource('building-labels.geojson'));
  assert.ok(labels.features.length > 0);
  const fixture = JSON.parse(readPinnedFixture('podgorica-places.geojson'));
  assert.ok(fixture.features.length > 0);
});

function webTestFiles() {
  // This file holds the rule's text, so it cannot also be subject to it.
  const guardFile = 'pinned-data.test.mjs';
  const files = fileSystem
    .readdirSync(new URL('tests/', applicationRoot), {recursive: true})
    .filter(file => file !== guardFile && /\.(?:mjs|js|json)$/.test(file))
    .map(file => [`tests/${file}`, new URL(`tests/${file}`, applicationRoot)]);
  for (const directory of ['src', 'tools']) {
    const directoryUrl = new URL(`${directory}/`, applicationRoot);
    if (!fileSystem.existsSync(directoryUrl)) continue;
    for (const file of fileSystem.readdirSync(directoryUrl, {recursive: true})) {
      if (!/\.(?:test|browser\.test)\.(?:mjs|js)$/.test(file)) continue;
      files.push([`${directory}/${file}`, new URL(`${directory}/${file}`, applicationRoot)]);
    }
  }
  files.push(['playwright.config.mjs', new URL('playwright.config.mjs', applicationRoot)]);
  return files;
}

function assertNoRepositoryData(files = webTestFiles()) {
  for (const [name, file] of files) {
    assert.ok(!repositoryDataPattern.test(fileSystem.readFileSync(file, 'utf8')), `${name}: ${pinnedDataRule}`);
  }
}

test('web tests and the browser config never read repository data', () => {
  assertNoRepositoryData();
});

test('web tests reject path builders that target repository data', t => {
  const probeName = `__data-join-probe-${process.pid}.mjs`;
  const probe = new URL(`tests/${probeName}`, applicationRoot);
  t.after(() => fileSystem.rmSync(probe, {force: true}));
  fileSystem.writeFileSync(probe, "export const source = path.join(repositoryRoot, 'data', 'sources', 'places.geojson');\n");
  assert.throws(() => assertNoRepositoryData([[probeName, probe]]), new RegExp(probeName));
});
