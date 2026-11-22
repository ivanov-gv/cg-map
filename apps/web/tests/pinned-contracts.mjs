// The one place web tests resolve shared contracts. npm resolves this through the exact pinned devDependency.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const pinnedContractsRoot = path.dirname(
  fileURLToPath(import.meta.resolve('@ivanov-gv/map-contracts/package.json'))
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedContractsRoot);
