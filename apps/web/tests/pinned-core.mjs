// This helper resolves map-core's root and re-exports roadLayerIds for tests. npm resolves the package through the exact
// pinned dependency, so a change to packages/map-core cannot change a test without an intentional pin bump.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export {roadLayerIds} from '@ivanov-gv/map-core';

const coreToolsDirectory = path.dirname(
  fileURLToPath(import.meta.resolve('@ivanov-gv/map-core/tools/assemble.mjs'))
);
export const pinnedCoreRoot = path.resolve(coreToolsDirectory, '..');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedCoreRoot);
