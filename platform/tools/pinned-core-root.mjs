// Platform's hosting test builds the web artifact from its own core pin, never from an app copy or the repository.
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const assembleModule = require.resolve('@ivanov-gv/map-core/tools/assemble.mjs');
export const pinnedCoreRoot = path.resolve(path.dirname(assembleModule), '..');
const installedSuffix = path.join('node_modules', '@ivanov-gv', 'map-core');
if (!pinnedCoreRoot.endsWith(installedSuffix))
  throw new Error('platform must pin @ivanov-gv/map-core outside repository sources');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedCoreRoot);
