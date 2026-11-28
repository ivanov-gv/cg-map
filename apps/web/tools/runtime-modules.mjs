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
const gestureHandlerPattern =
  /\.(?:scrollZoom|touchZoomRotate|doubleClickZoom|dragPan|dragRotate|keyboard|boxZoom|touchPitch|cooperativeGestures)\b/;
const publishedCoreEntry = '@ivanov-gv/map-core';

// Per-folder rules: a module may import its own folder, the folders listed here, and the published map-core entry.
// app.js is the root entry and may import any feature folder. sw.js has no local imports.
const folderDependencyRules = new Map([
  ['', new Set(['shared', 'map', 'selection', 'routing', 'transport', 'offline', 'location', 'interface'])],
  ['shared', new Set(['shared'])],
  ['map', new Set(['shared', 'map'])],
  ['selection', new Set(['shared', 'selection', 'interface'])],
  ['routing', new Set(['shared', 'routing'])],
  ['transport', new Set(['shared', 'transport'])],
  ['offline', new Set(['shared', 'transport', 'offline'])],
  ['location', new Set(['shared', 'location'])],
  ['interface', new Set(['shared', 'interface'])]
]);

// Modules that existed on main with no local imports may not gain any, even inside their folder.
const modulesWithoutLocalImports = new Set([
  'map/attribution.js',
  'offline/app-updates.js',
  'shared/core.js',
  'transport/data-mode.js',
  'shared/device-class.js',
  'shared/dom.js',
  'interface/history-steps.js',
  'map/map-taps.js',
  'selection/object-selection.js',
  'selection/point-selection.js',
  'routing/routing.js',
  'transport/vehicle-direction.js'
]);

const notImportedByAppOnMain = new Set([
  'interface/history-steps.js',
  'routing/routing.js',
  'routing/transit-routing.js',
  'transport/vehicle-direction.js'
]);

// Reviewed edges from main, translated to their feature-folder paths. New modules may be added, but these modules keep
// the imports main allowed and may not widen transitively to other main modules.
const moduleImportRulesOnMain = new Map([
  ['interface/interface.js', ['../shared/device-class.js', './history-steps.js']],
  [
    'location/location-controls.js',
    [publishedCoreEntry, '../shared/core.js', '../shared/dom.js', './position.js', '../shared/status-messages.js']
  ],
  ['selection/map-selection.js', ['./point-selection.js']],
  ['offline/offline-controls.js', ['../transport/data-mode.js', '../shared/dom.js', './offline.js']],
  ['offline/offline.js', ['../shared/core.js']],
  ['selection/place-details.js', [publishedCoreEntry, '../shared/core.js', '../shared/dom.js']],
  [
    'selection/place-selection.js',
    ['../interface/interface.js', publishedCoreEntry, '../shared/core.js', '../shared/dom.js', './place-details.js']
  ],
  ['location/position.js', ['../shared/core.js']],
  ['map/public-map-layers.js', [publishedCoreEntry, '../shared/core.js']],
  ['routing/route-planner.js', ['../shared/dom.js', './routing.js', './transit-routing.js', '../shared/core.js']],
  ['shared/status-messages.js', ['./core.js']],
  ['routing/transit-routing.js', ['../shared/core.js']],
  ['transport/transport.js', ['./vehicle-direction.js', './data-mode.js']]
]);

// Fixtures stand in for the reviewed tree, so they use this list instead of a second hand-written copy.
export const mainRuntimeModules = Object.freeze(
  ['app.js', ...modulesWithoutLocalImports, ...moduleImportRulesOnMain.keys()].sort()
);

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

function folderName(moduleName) {
  const directory = path.posix.dirname(moduleName);
  return directory === '.' ? '' : directory;
}

function topLevelFolder(moduleName) {
  const folder = folderName(moduleName);
  return folder.split('/')[0] ?? folder;
}

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

function localModuleName(specifier, moduleName) {
  if (specifier === publishedCoreEntry || !specifier.startsWith('.')) return null;
  return dependencyPath('.', path.join('.', moduleName), specifier);
}

function assertReviewedImport(sourceDirectory, moduleName, filePath, dependency) {
  const dependenciesOnMain = dependenciesOnMainFor(moduleName) ?? [];
  const isRelativeRuntimeModule = isRelativeJs(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency);
  const isReviewedSpecifier = dependency === publishedCoreEntry || isRelativeRuntimeModule;
  // A module with local edges on main may gain a new module; a zero-import module may not, and no reviewed module may
  // gain a different module that main already knew.
  const isZeroImportModule = dependenciesOnMain.length === 0;
  const addsModule =
    dependenciesOnMain.length > 0 && isRelativeRuntimeModule && isModuleAddedSinceMain(sourceDirectory, filePath, dependency);
  const reviewedPaths = new Set(
    dependenciesOnMain.map(specifier => localModuleName(specifier, moduleName)).filter(Boolean)
  );
  const dependencyTarget = isRelativeRuntimeModule ? dependencyPath(sourceDirectory, filePath, dependency) : null;
  const isReviewedEdge =
    dependency === publishedCoreEntry
      ? dependenciesOnMain.includes(publishedCoreEntry)
      : Boolean(dependencyTarget && reviewedPaths.has(dependencyTarget));
  const message = isZeroImportModule
    ? `${moduleName}: may not import ${dependency}. Modules with no local imports on main may not gain any local module, new or old.`
    : `${moduleName}: forbidden dependency ${dependency}. Web keeps main's reviewed import graph; only its listed modules and new modules are allowed.`;
  assert.ok(isReviewedSpecifier && (isReviewedEdge || addsModule), message);
}

function allowedFoldersFor(moduleName) {
  const folder = topLevelFolder(moduleName);
  if (folder === '') return null;
  return folderDependencyRules.get(folder) ?? new Set(['shared', folder]);
}

function assertFolderBoundary(sourceDirectory, moduleName, filePath, dependency) {
  const allowedFolders = allowedFoldersFor(moduleName);
  if (dependency === publishedCoreEntry) return;
  assert.ok(isRelativeJs(dependency), `${moduleName}: forbidden dependency ${dependency}.`);
  assert.ok(
    isRuntimeDependency(sourceDirectory, filePath, dependency),
    `${moduleName}: forbidden dependency ${dependency}. Only relative runtime modules inside src and the published @ivanov-gv/map-core entry are allowed.`
  );
  if (allowedFolders === null) return;
  const dependencyModule = dependencyPath(sourceDirectory, filePath, dependency);
  const dependencyFolder = topLevelFolder(dependencyModule);
  assert.ok(
    allowedFolders.has(dependencyFolder),
    `${moduleName}: forbidden dependency ${dependency}. Feature folders may import only their allowed folders: ${[...allowedFolders].sort().join(', ')}.`
  );
}

function assertGeneralImport(sourceDirectory, moduleName, filePath, dependency) {
  assertFolderBoundary(sourceDirectory, moduleName, filePath, dependency);
}

function reviewedClosure(moduleName) {
  const reached = new Set([moduleName]);
  const visit = name => {
    for (const dependency of dependenciesOnMainFor(name) ?? []) {
      const target = localModuleName(dependency, name);
      if (!target || reached.has(target)) continue;
      reached.add(target);
      visit(target);
    }
  };
  visit(moduleName);
  return reached;
}

// A new import path must not widen a reviewed module's main imports; the closure records the allowed reach.
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

// A reviewed rule names a path from main. If #456 moves that path again, the rule moves into this file's per-folder rules.
export function assertReviewedModulesExist(sourceDirectory = defaultSourceDirectory) {
  for (const moduleName of mainRuntimeModules) {
    assert.ok(
      fs.existsSync(path.join(sourceDirectory, moduleName)),
      `${moduleName}: reviewed module missing from src. Move its rule into the per-folder rules of #456.`
    );
  }
}

// New modules may import any module in their allowed folders, but a reviewed module may not reach new main modules through them.
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
      assertFolderBoundary(sourceDirectory, moduleName, filePath, dependency);
    } else {
      assertGeneralImport(sourceDirectory, moduleName, filePath, dependency);
    }
  }
}

// Enforces ADR 0015, per-folder import boundaries, and main's reviewed import graph for every runtime module.
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
