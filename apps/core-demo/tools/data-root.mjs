import path from 'node:path';
import {pinnedDataRoot} from '../tests/pinned-data.mjs';

// Test targets set MAP_DATA_ROOT to the pinned package. A dev build keeps the repository data root, so callers pass that
// default explicitly. An explicitly empty value is a configuration error, not a reason to fall back silently.
export function resolveDataRoot(defaultRoot, options = {}) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  const selectedRoot = process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
  if (options.release && selectedRoot !== pinnedDataRoot) {
    throw new Error(`A release build must bundle the pinned @ivanov-gv/map-data, not ${selectedRoot}`);
  }
  return selectedRoot;
}
