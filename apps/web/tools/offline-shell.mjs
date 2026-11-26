// Derives the service-worker shell from the built artifact. Generated manifests describe the shell, so they must never
// become part of the discovered inventory or its hash. Archive and partial range downloads stay in OPFS and HTTP caches.
import fs from 'node:fs';
import path from 'node:path';
import {isRuntimeSourcePath} from './runtime-modules.mjs';

const excludedArtifactPaths = new Set([
  '.nojekyll',
  'config.json',
  'offline-manifest.js',
  'sw.js',
  'data/manifest.json'
]);

function walk(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

// Returns true for a shipped runtime file or local asset. Extension rules cover whole directories, so adding a module or
// a satellite tile needs no list edit, while host config, generated output, downloads, and tests stay outside the shell.
export function isShellAsset(relativePath) {
  if (excludedArtifactPaths.has(relativePath)) return false;
  if (!isRuntimeSourcePath(relativePath)) return false;
  const segments = relativePath.split('/');
  const filename = segments.at(-1);
  // The data allow rules include archive-like extensions; this guard is what keeps a widened rule from caching full
  // archives or partial range downloads. Those bytes stay in OPFS and HTTP caches.
  if (filename.endsWith('.pmtiles') || filename.endsWith('.partial')) return false;
  if (segments[0] === 'vendor') return /\.(?:js|css)$/.test(filename);
  if (segments[0] === 'map-core') return filename.endsWith('.js');
  if (segments[0] === 'fonts') return filename.endsWith('.pbf');
  if (segments[0] === 'data') {
    if (segments[1] === 'satellite') return /\.(?:webp|png|json|pmtiles|partial)$/.test(filename);
    return /\.(?:geojson|json|pmtiles|partial)$/.test(filename) && filename !== 'manifest.json';
  }
  return /\.(?:js|html|css|svg|png|webmanifest)$/.test(filename);
}

// Sorted so the same artifact always produces the same shell order and the same cache name.
export function discoverShellAssets(outputDirectory) {
  return walk(outputDirectory)
    .map(filePath => path.relative(outputDirectory, filePath).split(path.sep).join('/'))
    .filter(isShellAsset)
    .sort();
}

export function assertShellIncludesModules(sourceModules, shell) {
  const missing = sourceModules.filter(sourceModule => sourceModule !== 'sw.js' && !shell.includes(sourceModule));
  if (missing.length) throw new Error(`Offline shell is missing runtime module(s): ${missing.join(', ')}`);
}
