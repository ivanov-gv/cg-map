import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {pinnedDataRoot, readPinnedSource} from './pinned-data.mjs';

const applicationRoot = new URL('..', import.meta.url);
const ruleTextStart = '// Pin guard rule text starts here.';
const ruleTextEnd = '// Pin guard rule text ends here.';

// Pin guard rule text starts here.
const pinnedDataRule = 'editor tests must read data and data tools from the pinned @ivanov-gv/map-data package, not the repository data folder';
const repositoryDataPattern = new RegExp(
  [
    '(?:\\.\\./)+data(?:/|[\'"`])',
    '(?<!map-)data/(?:sources|tools|artifacts|imagery)\\b',
    '(?:join|resolve)\\s*\\([^)]*[\'"]data[\'"]\\s*,\\s*[\'"](?:sources|tools|artifacts|imagery)[\'"]'
  ].join('|')
);
// Pin guard rule text ends here.

const testFolderScript = /\.(?:js|mjs|json)$/;
const colocatedTestScript = /\.(?:test|browser\.test|spec)\.(?:js|mjs)$/;

// tests/ and the optional e2e/ folder hold only test support, so every script there is checked. src/ and tools/ hold
// production files with legitimate HEAD dev resolvers; only their colocated tests are checked.
function filesUnder(directory, namePattern) {
  const root = new URL(`${directory}/`, applicationRoot);
  return fileSystem.readdirSync(root, {recursive: true})
    .filter(file => namePattern.test(file))
    .map(file => [`${directory}/${file}`, new URL(`${directory}/${file}`, applicationRoot)]);
}

function guardedFiles() {
  const files = [
    ...filesUnder('tests', testFolderScript),
    ...filesUnder('src', colocatedTestScript),
    ...filesUnder('tools', colocatedTestScript)
  ];
  if (fileSystem.existsSync(new URL('e2e/', applicationRoot))) {
    files.push(...filesUnder('e2e', testFolderScript));
  }
  files.push(['playwright.config.mjs', new URL('playwright.config.mjs', applicationRoot)]);
  return files;
}

function withoutRuleText(contents) {
  const start = contents.indexOf(ruleTextStart);
  if (start === -1) return contents;
  const end = contents.indexOf(ruleTextEnd, start);
  if (end === -1) return contents;
  return `${contents.slice(0, start)}${contents.slice(end + ruleTextEnd.length)}`;
}

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
  const files = guardedFiles();
  const names = files.map(([name]) => name);
  assert.ok(names.includes('tests/e2e/fixture-city.mjs'), 'the pin guard must cover test helpers');
  assert.ok(
    names.some(name => name.startsWith('tests/e2e/') && name.endsWith('.spec.mjs')),
    'the pin guard must cover browser specs'
  );
  assert.ok(
    names.some(name => name.startsWith('src/') && name.endsWith('.test.js')),
    'the pin guard must cover colocated source tests'
  );
  assert.ok(names.includes('tools/browser-matrix.test.js'), 'the pin guard must cover tool tests');

  for (const [name, file] of files) {
    const contents = withoutRuleText(fileSystem.readFileSync(file, 'utf8'));
    assert.ok(!repositoryDataPattern.test(contents), `${name}: ${pinnedDataRule}`);
  }
});
