import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// A build that is not a release takes the core of its own commit. A release build and the tests set MAP_CORE_ROOT to this
// app's own pin.
export const repositoryCoreRoot = fileURLToPath(new URL('../../../packages/map-core', import.meta.url));

// Returns the core root for this run; an explicitly empty input is a configuration error, not a silent fallback.
export function resolveCoreRoot() {
  if ('MAP_CORE_ROOT' in process.env && !process.env.MAP_CORE_ROOT) {
    throw new Error('MAP_CORE_ROOT is set but empty; release and test targets must resolve @ivanov-gv/map-core');
  }
  return process.env.MAP_CORE_ROOT ? path.resolve(process.env.MAP_CORE_ROOT) : repositoryCoreRoot;
}

// One of the core's build or runtime modules, from the same root as everything else of it.
export const importCoreModule = modulePath => import(pathToFileURL(path.join(resolveCoreRoot(), modulePath)).href);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(resolveCoreRoot());
