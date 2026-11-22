// Platform's hosting test builds the web artifact from its own map-data pin, never from an app's copy or repository HEAD.
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
export const pinnedDataRoot = path.dirname(require.resolve('@ivanov-gv/map-data/package.json'));

if (pinnedDataRoot === path.join(repositoryRoot, 'data'))
  throw new Error('platform must pin @ivanov-gv/map-data outside the workspace data folder');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedDataRoot);
