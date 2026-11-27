// The one place editor tests and release builds resolve map-core. npm resolves the exact dependency, so a change to
// packages/map-core cannot change them without a pin bump.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const coreToolsDirectory = path.dirname(
  fileURLToPath(import.meta.resolve('@ivanov-gv/map-core/tools/assemble.mjs'))
);
export const pinnedCoreRoot = path.resolve(coreToolsDirectory, '..');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedCoreRoot);
