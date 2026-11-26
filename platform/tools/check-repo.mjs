import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {findLogProblems, readLog} from './decision-log.mjs';
import {unreachableInstructions} from './instruction-reach.mjs';

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function walkDirectories(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).flatMap(e => {
    const child = path.join(dir, e.name);
    return [child, ...walkDirectories(child)];
  });
}
const docsTree = walk('docs');
for (const file of docsTree) {
  assert.ok(file.endsWith('.md'), `docs/ must contain Markdown only: ${file}`);
}
for (const name of ['README.md', 'AGENTS.md']) {
  assert.ok(fs.existsSync(path.join('docs', name)), `docs/ must contain ${name}`);
}
const docsRoot = fs.readdirSync('docs', {withFileTypes: true});
for (const entry of docsRoot) {
  assert.ok(entry.isDirectory() || ['README.md', 'AGENTS.md'].includes(entry.name), `docs/ root only allows README.md, AGENTS.md, and topic folders: ${entry.name}`);
}
for (const dir of ['docs', ...walkDirectories('docs')]) {
  for (const name of ['README.md', 'AGENTS.md']) {
    assert.ok(fs.existsSync(path.join(dir, name)), `${dir}/ must contain ${name}`);
  }
}
const docs = ['README.md', 'AGENTS.md',
  ...['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts', 'packages/map-core', 'apps/core-demo', 'apps/editor', 'tests'].flatMap(dir => ['README.md', 'AGENTS.md'].map(name => `${dir}/${name}`)),
  ...docsTree.filter(file => file.endsWith('.md'))];
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${file}: broken link ${target}`);
  }
}
// Import lists may span lines, so the clause between the keyword and `from` must accept newlines.
const moduleDependencyPattern = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const imports = {
  'app-updates.js': [],
  'object-selection.js': [],
  'app.js': [
    '@ivanov-gv/map-core',
    './object-selection.js',
    './app-updates.js',
    './attribution.js',
    './core.js',
    './device-class.js',
    './offline.js',
    './transport.js',
    './point-selection.js',
    './route-planner.js',
    './map-taps.js',
    './data-mode.js',
    './position.js',
    './interface.js',
    './dom.js',
    './place-details.js',
    './public-map-layers.js',
    './map-selection.js',
    './offline-controls.js',
    './status-messages.js',
    './place-selection.js',
    './location-controls.js'
  ],
  'location-controls.js': ['@ivanov-gv/map-core', './core.js', './dom.js', './position.js', './status-messages.js'],
  'dom.js': [],
  'place-details.js': ['@ivanov-gv/map-core', './core.js', './dom.js'],
  'public-map-layers.js': ['@ivanov-gv/map-core', './core.js'],
  'map-selection.js': ['@ivanov-gv/map-core', './point-selection.js'],
  'offline-controls.js': ['./data-mode.js', './dom.js', './offline.js'],
  'status-messages.js': ['./core.js'],
  'place-selection.js': ['@ivanov-gv/map-core', './core.js', './dom.js', './place-details.js', './interface.js'],
  'attribution.js': [],
  'device-class.js': [],
  'history-steps.js': [],
  'interface.js': ['./device-class.js', './history-steps.js'],
  'core.js': [],
  'offline.js': ['./core.js'],
  'transport.js': ['./vehicle-direction.js', './data-mode.js'],
  'vehicle-direction.js': [],
  'data-mode.js': [],
  'point-selection.js': [],
  'map-taps.js': [],
  'position.js': ['./core.js'],
  'routing.js': [],
  'transit-routing.js': ['./core.js'],
  'route-planner.js': ['./dom.js', './routing.js', './transit-routing.js', './core.js']
};
for (const file of fs.readdirSync('apps/web/src').filter(file => file.endsWith('.js'))) {
  if (file === 'sw.js') continue;
  assert.ok(Object.hasOwn(imports, file), `Document boundaries for new web module ${file} in platform/tools/check-repo.mjs`);
  const text = fs.readFileSync(path.join('apps/web/src', file), 'utf8');
  assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need an explicit boundary check`);
  for (const match of text.matchAll(moduleDependencyPattern)) {
    assert.ok(imports[file].includes(match[1]), `${file}: forbidden dependency ${match[1]}. Consume published data/contracts, not pipeline or server code.`);
  }
}
// ADR 0015: map gestures are MapLibre's own. A web module that reconfigures or replaces a gesture handler needs a new
// decision first, because #78 did that from synthetic tests and broke touchpad zoom.
const gestureHandlerPattern = /\.(?:scrollZoom|touchZoomRotate|doubleClickZoom|dragPan|dragRotate|keyboard|boxZoom|touchPitch|cooperativeGestures)\b/;
for (const file of fs.readdirSync('apps/web/src').filter(file => file.endsWith('.js'))) {
  const text = fs.readFileSync(path.join('apps/web/src', file), 'utf8');
  assert.ok(!gestureHandlerPattern.test(text), `${file}: map gestures stay MapLibre's own (docs/decisions/0015-maplibre-gestures-unchanged.md)`);
}
for (const file of walk('data/tools').filter(file => file.endsWith('.mjs'))) {
  assert.ok(!/from\s*['"][^'"]*(?:apps\/web|services\/backend)/.test(fs.readFileSync(file, 'utf8')), `${file}: data pipelines must not import application implementation`);
}
// Core-demo tests, their browser configuration and tools written only for tests read data from the pinned package.
// Web and editor own the same guard in their own tests/pinned-data.test.mjs. Register a new core-demo test-only tool
// here; a tool used by a build stays out, because dev and release builds read the repository's data.
const TEST_ONLY_APP_TOOLS = [];
const pinnedDataRule = 'core-demo tests must read data and data tools from the pinned @ivanov-gv/map-data package, not the repository data folder';
const repositoryDataPattern = new RegExp(
  [
    '(?:\\.\\./)+data(?:/|[\'"`])',
    '(?<!map-)data/(?:sources|tools|artifacts|imagery)\\b',
    '(?:join|resolve)\\s*\\([^)]*[\'"]data[\'"]\\s*,\\s*[\'"](?:sources|tools|artifacts|imagery)[\'"]'
  ].join('|')
);
for (const application of ['apps/core-demo']) {
  const configFile = `${application}/playwright.config.mjs`;
  const testFiles = [
    ...walk(`${application}/tests`).filter(file => /\.(?:mjs|js|json)$/.test(file)),
    ...(fs.existsSync(configFile) ? [configFile] : []),
    ...TEST_ONLY_APP_TOOLS.filter(file => file.startsWith(`${application}/`))
  ];
  for (const file of testFiles) {
    assert.ok(
      !repositoryDataPattern.test(fs.readFileSync(file, 'utf8')),
      `${file}: ${pinnedDataRule}`
    );
  }
}
// Cross-project tests default to repository data, but that choice lives in one helper so a release can point the whole
// suite at a published package. Every other test file must use the helper.
const integrationDataHelper = 'tests/data-root.mjs';
const integrationDataRule = 'integration tests must read data and data tools through tests/data-root.mjs';
const integrationTestFiles = walk('tests').filter(file =>
  !file.includes('/node_modules/') && (/\.(?:mjs|js|json)$/.test(file) || file.endsWith('/Makefile'))
);
assert.ok(fs.existsSync(integrationDataHelper), `Missing integration data helper: ${integrationDataHelper}`);
for (const file of integrationTestFiles) {
  if (file === integrationDataHelper) continue;
  assert.ok(!repositoryDataPattern.test(fs.readFileSync(file, 'utf8')), `${file}: ${integrationDataRule}`);
}
// Consumers resolve contracts from their pinned package in tests. Each app build has one HEAD-root resolver; data and
// tests/ own their own HEAD exceptions.
const CONTRACT_PATH_HELPER = 'tests/contracts-root.mjs';
const DEV_CONTRACT_ROOTS = new Set([
  'apps/web/tools/contracts-root.mjs',
  'apps/editor/tools/contracts-root.mjs',
  'apps/core-demo/tools/contracts-root.mjs'
]);
// Platform's planner, verifier, guard and their tests name repository contract paths as data, not as consumer reads.
const contractPathMetadata = new Set([
  'platform/tools/check-repo.mjs',
  'platform/tools/ci-plan.mjs',
  'platform/tools/verify.mjs',
  'platform/tests/agents.test.mjs',
  'platform/tests/ci-plan.test.mjs',
  'platform/tests/makefiles.test.mjs',
  'platform/tests/package-pins.test.mjs',
  'platform/tests/workflows.test.mjs'
]);
// Match the directory itself: any extension, interpolation or join style still reads unreleased contracts.
const repositoryContractsPattern = new RegExp(
  [
    '(?<![\\w-])(?:\\.\\.\\/)*packages\\/contracts\\b',
    '(?<![\\w-])(?:\\.\\.\\/)+contracts\\/',
    "['\"]packages['\"]\\s*,\\s*['\"]contracts['\"]"
  ].join('|')
);
const pinnedContractsRule = 'relative contract paths must go through the pinned @ivanov-gv/map-contracts package or a sanctioned app build resolver';
// These probes keep the guard honest about the paths and join styles earlier versions missed.
const contractPathProbes = [
  ['template literal', '`../../packages/contracts/${name}`'],
  ['directory join', "path.join(root, 'packages/contracts')"],
  ['split join', "path.join(root, 'packages', 'contracts')"],
  ['map-core relative', "'../../contracts/schema.json'"],
  ['Makefile proto', '$(ROOT)/packages/contracts/proto/vehicles.proto']
];
for (const [form, probe] of contractPathProbes) {
  assert.match(probe, repositoryContractsPattern, `${form} must be rejected by ${pinnedContractsRule}`);
}
const contractConsumers = ['apps/web', 'apps/editor', 'apps/core-demo', 'packages/map-core', 'platform', 'services/backend', 'services/transit-relay', 'tests'];
for (const component of contractConsumers) {
  const files = walk(component).filter(
    file => (/\.(?:mjs|js|json|go|py)$/.test(file) || file.endsWith('/Makefile')) && !file.includes('/node_modules/')
  );
  for (const file of files) {
    if (file === CONTRACT_PATH_HELPER || contractPathMetadata.has(file) || DEV_CONTRACT_ROOTS.has(file)) continue;
    assert.ok(!repositoryContractsPattern.test(fs.readFileSync(file, 'utf8')), `${file}: ${pinnedContractsRule}`);
  }
}
const rootFiles = new Set(['README.md', 'AGENTS.md', 'LICENSE', 'Makefile', 'package.json', 'package-lock.json', 'eslint.config.mjs']);
for (const entry of fs.readdirSync('.', {withFileTypes: true})) {
  if (entry.isFile() && !entry.name.startsWith('.')) assert.ok(rootFiles.has(entry.name), `Root clutter: ${entry.name}. Put code under its owning component.`);
}
for (const old of ['web', 'source-data', 'cmd', 'tools', 'deployment', 'go.mod', 'index.html', 'sw.js', '.pages-manifest.json']) {
  assert.ok(!fs.existsSync(old), `Obsolete layout: ${old}`);
}
for (const component of ['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts', 'packages/map-core', 'apps/core-demo', 'apps/editor', 'tests']) {
  assert.ok(fs.existsSync(`${component}/AGENTS.md`), `Missing component instructions: ${component}`);
}

// Keep shared runtime independent, and keep the concept consumer honest about its public-only imports.
for (const component of ['packages/map-core', 'apps/core-demo', 'apps/editor']) {
  // Source-owned unit tests live next to code in these components; boundary checks apply to runtime modules only.
  for (const file of walk(`${component}/src`).filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need a declared boundary`);
    for (const match of text.matchAll(moduleDependencyPattern)) {
      const dependency = match[1];
      const isCoreEntry = dependency === '@ivanov-gv/map-core';
      const isSibling = /^\.\/[^/]+\.js$/.test(dependency);
      const isRelativeInsideSrc = /^\.\.?\/.*\.js$/.test(dependency) &&
        !path.relative(`${component}/src`, path.resolve(path.dirname(file), dependency)).startsWith('..');
      const allowedByComponent = {
        'apps/core-demo': isCoreEntry,
        'packages/map-core': isSibling,
        'apps/editor': isCoreEntry || isRelativeInsideSrc
      };
      const isAllowed = allowedByComponent[component];
      assert.ok(isAllowed, `${file}: forbidden dependency ${dependency}`);
    }
  }
}
assert.deepEqual(findLogProblems(readLog('docs/decisions')), [], 'The decisions log is out of sequence');
// Every instruction file must be reachable from the root AGENTS.md, so agents that do not load nested files still find it.
const instructionFiles = [
  ...execFileSync('git', ['ls-files', 'AGENTS.md', '**/AGENTS.md'], {encoding: 'utf8'}).split('\n').filter(Boolean),
  '.github/pull_request_template.md',
  '.github/TESTING.md'
];
assert.deepEqual(unreachableInstructions('.', instructionFiles), [], 'Link these instruction files from the root AGENTS.md or a file it links');
console.log('Documentation links, instruction reach, decisions log, component layout, data roots, and dependency boundaries passed.');
