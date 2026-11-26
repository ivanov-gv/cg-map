// Web owns the rules for its runtime modules: where they may live, what they may import, and which browser gestures stay
// with MapLibre. Build and offline discovery share the same definition of a runtime module, so a new nested file needs
// no list entry and a colocated test never reaches the artifact.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath, pathToFileURL} from 'node:url';

const supportDirectoryNames = new Set(['test-support', 'test-helpers', 'tests', '__tests__', 'fixtures']);
// Import lists may span lines, so the clause between the keyword and `from` must accept newlines.
const moduleDependencyPattern = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const dynamicImportPattern = /\bimport\s*\(/;
const gestureHandlerPattern = /\.(?:scrollZoom|touchZoomRotate|doubleClickZoom|dragPan|dragRotate|keyboard|boxZoom|touchPitch|cooperativeGestures)\b/;
const publishedCoreEntry = '@ivanov-gv/map-core';

// main's flat import graph has no naming or layer rule that predicts every edge: interface.js imports history-steps.js
// while app.js does not, and offline.js imports only core.js. Keep the reviewed edges as rules, scoped to the modules
// main constrained. New nested modules follow the general relative-module rule below instead of needing a list entry.
const modulesWithoutLocalImports = new Set([
  'app-updates.js',
  'attribution.js',
  'core.js',
  'data-mode.js',
  'device-class.js',
  'dom.js',
  'history-steps.js',
  'map-taps.js',
  'object-selection.js',
  'point-selection.js',
  'routing.js',
  'vehicle-direction.js'
]);
const transitiveOnlyModules = new Set(['history-steps.js', 'routing.js', 'transit-routing.js', 'vehicle-direction.js']);
const reviewedDependencies = new Map([
  ['interface.js', ['device-class.js', 'history-steps.js']],
  ['location-controls.js', [publishedCoreEntry, 'core.js', 'dom.js', 'position.js', 'status-messages.js']],
  ['map-selection.js', [publishedCoreEntry, 'point-selection.js']],
  ['offline-controls.js', ['data-mode.js', 'dom.js', 'offline.js']],
  ['offline.js', ['core.js']],
  ['place-details.js', [publishedCoreEntry, 'core.js', 'dom.js']],
  ['place-selection.js', [publishedCoreEntry, 'core.js', 'dom.js', 'interface.js', 'place-details.js']],
  ['position.js', ['core.js']],
  ['public-map-layers.js', [publishedCoreEntry, 'core.js']],
  ['route-planner.js', ['core.js', 'dom.js', 'routing.js', 'transit-routing.js']],
  ['status-messages.js', ['core.js']],
  ['transit-routing.js', ['core.js']],
  ['transport.js', ['data-mode.js', 'vehicle-direction.js']]
]);
const runtimeModulesOnMain = ['app.js', ...modulesWithoutLocalImports, ...reviewedDependencies.keys()].sort();
reviewedDependencies.set(
  'app.js',
  runtimeModulesOnMain
    .filter(module => module !== 'app.js' && !transitiveOnlyModules.has(module))
    .concat(publishedCoreEntry)
);

const defaultSourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function relativePathFrom(sourceDirectory, filePath) {
  return path.relative(sourceDirectory, filePath).split(path.sep).join('/');
}

// Tests and their fixtures are not runtime modules. A runtime import of one would break the built artifact, so the same
// rule applies to both source discovery and dependency checks.
export function isRuntimeSourcePath(relativePath) {
  const segments = relativePath.split('/');
  const filename = segments.at(-1);
  const isTestFile = /\.(?:browser\.)?test\.(?:js|mjs)$/.test(filename);
  const isSupportFile = segments.some(segment => supportDirectoryNames.has(segment));
  return !isTestFile && !isSupportFile;
}

// Returns sorted runtime module paths relative to the source directory, at every nesting depth.
export function findRuntimeModules(sourceDirectory = defaultSourceDirectory) {
  return walk(sourceDirectory)
    .filter(filePath => relativePathFrom(sourceDirectory, filePath).endsWith('.js'))
    .map(filePath => relativePathFrom(sourceDirectory, filePath))
    .filter(isRuntimeSourcePath)
    .sort();
}

// Copies the source tree while keeping nested paths and leaving tests and support files behind.
export function copyRuntimeSource(sourceDirectory, outputDirectory) {
  fs.cpSync(sourceDirectory, outputDirectory, {
    recursive: true,
    filter: source => {
      const relativePath = relativePathFrom(sourceDirectory, source);
      return relativePath === '' || isRuntimeSourcePath(relativePath);
    }
  });
}

// Returns import specifiers in source order, including the published entry. Boundary checks use this one view.
function readDependencies(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  return [...text.matchAll(moduleDependencyPattern)].map(match => match[1]);
}

// Returns relative import specifiers only, so a test can name a fact such as core.js having no local imports.
export function readLocalDependencies(filePath) {
  return readDependencies(filePath).filter(dependency => dependency.startsWith('.'));
}

function isRelativeJs(dependency) {
  return /^\.\.?\/.*\.js$/.test(dependency);
}

// Returns true when a relative import resolves to a runtime module inside this app's source tree.
function isRuntimeDependency(sourceDirectory, sourceFile, dependency) {
  const resolvedPath = path.resolve(path.dirname(sourceFile), dependency);
  const relativePath = relativePathFrom(sourceDirectory, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith('../')) return false;
  return isRuntimeSourcePath(relativePath);
}

// Returns the relative path when an import adds a module that did not exist in main's flat tree.
function newRuntimeModulePath(sourceDirectory, sourceFile, dependency) {
  const resolvedPath = path.resolve(path.dirname(sourceFile), dependency);
  const relativePath = relativePathFrom(sourceDirectory, resolvedPath);
  if (relativePath === 'sw.js' || runtimeModulesOnMain.includes(relativePath)) return null;
  return isRuntimeSourcePath(relativePath) ? relativePath : null;
}

function dependenciesOnMainFor(relativePath) {
  if (reviewedDependencies.has(relativePath)) return reviewedDependencies.get(relativePath);
  if (modulesWithoutLocalImports.has(relativePath)) return [];
  return null;
}

function assertDependencyAllowed(sourceDirectory, relativePath, filePath, dependency) {
  const dependenciesOnMain = dependenciesOnMainFor(relativePath);
  if (dependenciesOnMain) {
    const isReviewedSpecifier =
      dependency === publishedCoreEntry ||
      (isRelativeJs(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency));
    const specifierOnMain = dependency === publishedCoreEntry ? dependency : dependency.replace(/^\.\//, '');
    // An importer that had local edges on main may gain a new nested module; a zero-import module may not, and no
    // importer may gain an unrelated module that main already knew.
    const mayAddNestedModule =
      dependenciesOnMain.length > 0 && Boolean(newRuntimeModulePath(sourceDirectory, filePath, dependency));
    assert.ok(
      isReviewedSpecifier && (dependenciesOnMain.includes(specifierOnMain) || mayAddNestedModule),
      `${relativePath}: forbidden dependency ${dependency}. Web keeps main's reviewed import graph; only its listed modules and new nested modules are allowed.`
    );
    return;
  }
  const isPublishedCoreEntry = dependency === publishedCoreEntry;
  const isRelativeRuntimeModule = isRelativeJs(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency);
  assert.ok(
    isPublishedCoreEntry || isRelativeRuntimeModule,
    `${relativePath}: forbidden dependency ${dependency}. Only relative runtime modules inside src and the published @ivanov-gv/map-core entry are allowed.`
  );
}

function assertModuleBoundaries(sourceDirectory, relativePath) {
  const filePath = path.join(sourceDirectory, relativePath);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(!dynamicImportPattern.test(text), `${relativePath}: dynamic imports need an explicit boundary check`);
  assert.ok(
    !gestureHandlerPattern.test(text),
    `${relativePath}: map gestures stay MapLibre's own (docs/decisions/0015-maplibre-gestures-unchanged.md)`
  );
  for (const dependency of readDependencies(filePath)) {
    assertDependencyAllowed(sourceDirectory, relativePath, filePath, dependency);
  }
}

// Enforces ADR 0015 and the published-package boundary for every runtime module, including nested ones.
export function assertRuntimeBoundaries(sourceDirectory = defaultSourceDirectory) {
  for (const relativePath of findRuntimeModules(sourceDirectory)) {
    assertModuleBoundaries(sourceDirectory, relativePath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertRuntimeBoundaries();
  console.log('Web runtime imports, dynamic imports, and map gestures passed.');
}
