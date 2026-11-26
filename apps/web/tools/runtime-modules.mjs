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

// Enforces ADR 0015 and the published-package boundary for every runtime module, including nested ones.
export function assertRuntimeBoundaries(sourceDirectory = defaultSourceDirectory) {
  for (const relativePath of findRuntimeModules(sourceDirectory)) {
    const filePath = path.join(sourceDirectory, relativePath);
    const text = fs.readFileSync(filePath, 'utf8');
    assert.ok(!dynamicImportPattern.test(text), `${relativePath}: dynamic imports need an explicit boundary check`);
    assert.ok(
      !gestureHandlerPattern.test(text),
      `${relativePath}: map gestures stay MapLibre's own (docs/decisions/0015-maplibre-gestures-unchanged.md)`
    );
    for (const match of text.matchAll(moduleDependencyPattern)) {
      const dependency = match[1];
      const isPublishedCoreEntry = dependency === '@ivanov-gv/map-core';
      const isRelativeModule = /^\.\.?\/.*\.js$/.test(dependency) && isRuntimeDependency(sourceDirectory, filePath, dependency);
      assert.ok(
        isPublishedCoreEntry || isRelativeModule,
        `${relativePath}: forbidden dependency ${dependency}. Only relative runtime modules inside src and the published @ivanov-gv/map-core entry are allowed.`
      );
    }
  }
}

function isRuntimeDependency(sourceDirectory, sourceFile, dependency) {
  const resolvedPath = path.resolve(path.dirname(sourceFile), dependency);
  const relativePath = relativePathFrom(sourceDirectory, resolvedPath);
  const isInsideSource = relativePath !== '..' && !relativePath.startsWith('../');
  return isInsideSource && isRuntimeSourcePath(relativePath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assertRuntimeBoundaries();
  console.log('Web runtime imports, dynamic imports, and map gestures passed.');
}
