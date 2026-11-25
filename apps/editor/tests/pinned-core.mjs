// The one place editor tests and release builds resolve map-core. npm resolves this through the exact pinned dependency, so a
// change to this repository's packages/map-core cannot change them without an intentional pin bump.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const assembleModule = fileURLToPath(import.meta.resolve('@ivanov-gv/map-core/tools/assemble.mjs'));
export const pinnedCoreRoot = path.resolve(path.dirname(assembleModule), '..');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedCoreRoot);
