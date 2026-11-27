import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {pinnedCoreRoot} from '../tests/pinned-core.mjs';

// A build that is not a release bundles the core of its own commit. Test targets and releases set MAP_CORE_ROOT to this
// app's pin; a release refuses every other root.
export const repositoryCoreRoot = fileURLToPath(new URL('../../../packages/map-core', import.meta.url));

// Returns the core root for this run; an explicitly empty input is a configuration error, not a silent fallback.
export function resolveCoreRoot(options = {}) {
  const override = process.env.MAP_CORE_ROOT;
  if ('MAP_CORE_ROOT' in process.env && !override) {
    throw new Error('MAP_CORE_ROOT is set but empty; release and test targets must resolve @ivanov-gv/map-core');
  }
  const selectedRoot = override ? path.resolve(override) : repositoryCoreRoot;
  if (options.release && !override) {
    throw new Error('A release build must set MAP_CORE_ROOT from tests/pinned-core.mjs');
  }
  if (options.release && selectedRoot !== pinnedCoreRoot) {
    throw new Error(`A release build must bundle the pinned @ivanov-gv/map-core, not ${selectedRoot}`);
  }
  return selectedRoot;
}

// Loads a module from the same core root whose runtime files the build copies into the artifact.
export function importCoreModule(modulePath, coreRoot = resolveCoreRoot()) {
  return import(pathToFileURL(path.join(coreRoot, modulePath)).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(resolveCoreRoot());
