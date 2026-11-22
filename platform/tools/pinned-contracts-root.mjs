// Platform's hosting test builds the web artifact from its own contracts pin, never from an app copy or repository HEAD.
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
export const pinnedContractsRoot = path.dirname(
  require.resolve('@ivanov-gv/map-contracts/package.json')
);
const installedSuffix = path.join('node_modules', '@ivanov-gv', 'map-contracts');
if (!pinnedContractsRoot.endsWith(installedSuffix))
  throw new Error('platform must pin @ivanov-gv/map-contracts outside repository sources');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedContractsRoot);
