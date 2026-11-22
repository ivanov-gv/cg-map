// The one place editor tests resolve map data. npm resolves this through the exact pinned devDependency, so a change to
// this repository's data/ folder cannot change a test without an intentional pin bump.
import fileSystem from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
export const pinnedDataRoot = path.dirname(require.resolve('@ivanov-gv/map-data/package.json'));

export function readPinnedSource(filename) {
  return fileSystem.readFileSync(path.join(pinnedDataRoot, 'sources', filename), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(pinnedDataRoot);
