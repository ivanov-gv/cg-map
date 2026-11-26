// Web owns the rules for its runtime modules: where they may live, what they may import, and which browser gestures stay
// with MapLibre. Build and offline discovery share the same definition of a runtime module, so a new module needs no
// list entry and a colocated test never reaches the artifact.
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
// main constrained. New modules follow the general relative-module rule below instead of needing a list entry.
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
const notImportedByAppOnMain = new Set(['history-steps.js', 'routing.js', 'transit-routing.js', 'vehicle-direction.js']);

const moduleImportRulesOnMain = new Map([
  ['interface.js', ['./device-class.js', './history-steps.js']],
  ['location-controls.js', [publishedCoreEntry, './core.js', './dom.js', './position.js', './status-messages.js']],
  ['map-selection.js', [publishedCoreEntry, './point-selection.js']],
  ['offline-controls.js', ['./data-mode.js', './dom.js', './offline.js']],
  ['offline.js', ['./core.js']],
  ['place-details.js', [publishedCoreEntry, './core.js', './dom.js']],
  ['place-selection.js', [publishedCoreEntry, './core.js', './dom.js', './interface.js', './place-details.js']],
  ['position.js', ['./core.js']],
  ['public-map-layers.js', [publishedCoreEntry, './core.js']],
  ['route-planner.js', ['./core.js', './dom.js', './routing.js', './transit-routing.js']],
  ['status-messages.js', ['./core.js']],
  ['transit-routing.js', ['./core.js']],
  ['transport.js', ['./data-mode.js', './vehicle-direction.js']]
]);

// Fixtures stand in for the flat tree, so they use this list instead of a second hand-written copy.
export const mainRuntimeModules = Object.freeze(
  ['app.js', ...modulesWithoutLocalImports, ...moduleImportRulesOnMain.keys()].sort()
);

// Returns app.js's entry with every flat module it imported on main, excluding those reached only through another module.
function appEntryOnMain() {
  const dependencies = mainRuntimeModules
    .filter(module => module !== 'app.js' && !notImportedByAppOnMain.has(module))
    .map(module => `./${module}`)
    .concat(publishedCoreEntry);
  return ['app.js', dependencies];
}

const reviewedDependencies = new Map([appEntryOnMain(), ...moduleImportRulesOnMain]);

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

function dependencyPath(sourceDirectory, sourceFile, dependency) {
  return relativePathFrom(sourceDirectory, path.resolve(path.dirname(sourceFile), dependency));
}

// Returns true when a relative import resolves to a runtime module inside this app's source tree.
function isRuntimeDependency(sourceDirectory, sourceFile, dependency) {
  const relativePath = dependencyPath(sourceDirectory, sourceFile, dependency);
  if (relativePath === '..' || relativePath.startsWith('../')) return false;
  return isRuntimeSourcePath(relativePath);
}

// True when an import resolves to a module that did not exist in main's flat tree.
function isModuleAddedSinceMain(sourceDirectory, sourceFile, dependency) {
  const relativePath = dependencyPath(sourceDirectory, sourceFile, dependency);
  if (relativePath === 'sw.js' || mainRuntimeModules.includes(relativePath)) return false;
  return isRuntimeSourcePath(relativePath);
}

function dependenciesOnMainFor(moduleName) {
  if (reviewedDependencies.has(moduleName)) return reviewedDependencies.get(moduleName);
  if (modulesWithoutLocalImports.has(moduleName)) return [];
  return null;
}

function localModuleName(specifier) {
  return specifier.startsWith('./') ? specifier.slice(2) : null;
}

function assertReviewedImport(sourceDirectory, moduleName, filePath, dependency) {
  const dependenciesOnMain = dependenciesOnMainFor(moduleName) ?? [];
  const isReviewedSpecifier =
    dependency === publishedCoreEntry ||
    (isRelativeJs(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency));
  // A module with local edges on main may gain a new module; a zero-import module may not, and no reviewed module may
  // gain a different module that main already knew.
  const addsModule = dependenciesOnMain.length > 0 && isModuleAddedSinceMain(sourceDirectory, filePath, dependency);
  assert.ok(
    isReviewedSpecifier && (dependenciesOnMain.includes(dependency) || addsModule),
    `${moduleName}: forbidden dependency ${dependency}. Web keeps main's reviewed import graph; only its listed modules and new modules are allowed.`
  );
}

function assertGeneralImport(sourceDirectory, moduleName, filePath, dependency) {
  const isPublishedEntry = dependency === publishedCoreEntry;
  const isRelativeRuntimeModule = isRelativeJs(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency);
  assert.ok(
    isPublishedEntry || isRelativeRuntimeModule,
    `${moduleName}: forbidden dependency ${dependency}. Only relative runtime modules inside src and the published @ivanov-gv/map-core entry are allowed.`
  );
}

function reviewedClosure(moduleName) {
  const reached = new Set([moduleName]);
  const visit = name => {
    for (const dependency of dependenciesOnMainFor(name) ?? []) {
      const target = localModuleName(dependency);
      if (!target || reached.has(target)) continue;
      reached.add(target);
      visit(target);
    }
  };
  visit(moduleName);
  return reached;
}
const reviewedClosures = new Map(mainRuntimeModules.map(moduleName => [moduleName, reviewedClosure(moduleName)]));

// Returns the main modules a module reaches now, following imports through modules added since main.
function reachedMainModules(sourceDirectory, moduleName) {
  const reached = new Set([moduleName]);
  const pending = [moduleName];
  while (pending.length) {
    const current = pending.shift();
    const currentPath = path.join(sourceDirectory, current);
    if (!fs.existsSync(currentPath)) continue;
    for (const dependency of readDependencies(currentPath)) {
      if (!isRelativeJs(dependency)) continue;
      const relativePath = dependencyPath(sourceDirectory, currentPath, dependency);
      if (!isRuntimeSourcePath(relativePath) || reached.has(relativePath)) continue;
      if (!fs.existsSync(path.join(sourceDirectory, relativePath))) continue;
      reached.add(relativePath);
      pending.push(relativePath);
    }
  }
  return mainRuntimeModules.filter(name => reached.has(name));
}

// A reviewed rule names a path on main. If #456 moves that path, the rule moves into that issue's per-folder rules.
export function assertReviewedModulesExist(sourceDirectory = defaultSourceDirectory) {
  for (const moduleName of mainRuntimeModules) {
    assert.ok(
      fs.existsSync(path.join(sourceDirectory, moduleName)),
      `${moduleName}: reviewed module missing from src. Move its rule into the per-folder rules of #456.`
    );
  }
}

// New modules may import any runtime module, but a reviewed module may not reach new main modules through them.
function assertReviewedClosures(sourceDirectory) {
  for (const moduleName of mainRuntimeModules) {
    const allowed = reviewedClosures.get(moduleName);
    const widened = reachedMainModules(sourceDirectory, moduleName).filter(name => !allowed.has(name));
    assert.deepEqual(
      widened,
      [],
      `${moduleName}: transitive imports reach main modules outside its reviewed graph (${widened.join(', ')}).`
    );
  }
}

function assertModuleBoundaries(sourceDirectory, moduleName) {
  const filePath = path.join(sourceDirectory, moduleName);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(!dynamicImportPattern.test(text), `${moduleName}: dynamic imports need an explicit boundary check`);
  assert.ok(
    !gestureHandlerPattern.test(text),
    `${moduleName}: map gestures stay MapLibre's own (docs/decisions/0015-maplibre-gestures-unchanged.md)`
  );
  const dependenciesOnMain = dependenciesOnMainFor(moduleName);
  for (const dependency of readDependencies(filePath)) {
    if (dependenciesOnMain) {
      assertReviewedImport(sourceDirectory, moduleName, filePath, dependency);
    } else {
      assertGeneralImport(sourceDirectory, moduleName, filePath, dependency);
    }
  }
}

// Enforces ADR 0015, the published-package boundary, and main's reviewed import graph for every runtime module.
export function assertRuntimeBoundaries(sourceDirectory = defaultSourceDirectory) {
  assertReviewedModulesExist(sourceDirectory);
  for (const moduleName of findRuntimeModules(sourceDirectory)) {
    assertModuleBoundaries(sourceDirectory, moduleName);
  }
  assertReviewedClosures(sourceDirectory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertRuntimeBoundaries();
  console.log('Web runtime imports, dynamic imports, and map gestures passed.');
}
