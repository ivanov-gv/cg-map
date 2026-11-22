import path from 'node:path';

// Test targets set MAP_DATA_ROOT to the pinned package. A dev build keeps the repository data root, so callers pass that
// default explicitly. An explicitly empty value is a configuration error, not a reason to fall back silently.
export function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}
