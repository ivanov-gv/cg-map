// The one place core-demo tests and release builds resolve map-core. npm resolves the exact dependency: this app pins
// workspace 0.0.0-dev because it is core's dev environment, so a core change reaches tests through that pin.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const coreToolsDirectory = path.dirname(
  fileURLToPath(import.meta.resolve('@ivanov-gv/map-core/tools/assemble.mjs'))
);
export const pinnedCoreRoot = path.resolve(coreToolsDirectory, '..');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedCoreRoot);
