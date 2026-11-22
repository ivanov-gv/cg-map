import fileSystem from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyMapCore, copyRuntimeAssets, relocateCoreImports} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {parseVisibilityConfig, assertPublishedPlaces} from '@ivanov-gv/map-core/src/place-visibility.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'dist/web');
// Dev builds default to the repository's HEAD; a future app production release pins every dependency, including data.
// Test targets set MAP_DATA_ROOT to the pinned package, and
// the data tools come from that same root so a test can never mix a pinned snapshot with a different tool revision.
function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}

const dataRoot = resolveDataRoot(path.join(root, 'data'));
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const {readVerifiedRelease} = await import(dataToolsURL);
const {release, archiveBytes} = readVerifiedRelease(dataRoot);
fileSystem.rmSync(output, {recursive: true, force: true});
fileSystem.cpSync(path.join(root, 'apps/web/public'), output, {recursive: true});
fileSystem.cpSync(path.join(root, 'apps/web/src'), output, {recursive: true});
copyMapCore(output);
copyRuntimeAssets(output);
const webModules = fileSystem
  .readdirSync(path.join(root, 'apps/web/src'))
  .filter(name => name.endsWith('.js'));
for (const filename of webModules) {
  const source = fileSystem.readFileSync(path.join(output, filename), 'utf8');
  fileSystem.writeFileSync(path.join(output, filename), relocateCoreImports(source));
}
fileSystem.mkdirSync(path.join(output, 'data'), {recursive: true});
fileSystem.writeFileSync(path.join(output, 'data', release.archive.file), archiveBytes);
const places = JSON.parse(fileSystem.readFileSync(path.join(dataRoot, 'sources/places.geojson')));
const visibilityConfig = JSON.parse(
  fileSystem.readFileSync(path.join(root, 'packages/contracts/place-visibility.json'))
);
assertPublishedPlaces(places.features, parseVisibilityConfig(visibilityConfig));
fileSystem.copyFileSync(
  path.join(dataRoot, 'sources/places.geojson'),
  path.join(output, 'data/places.geojson')
);
fileSystem.copyFileSync(
  path.join(root, 'packages/contracts/place-visibility.json'),
  path.join(output, 'data/place-visibility.json')
);
fileSystem.copyFileSync(
  path.join(dataRoot, 'sources/building-labels.geojson'),
  path.join(output, 'data/building-labels.geojson')
);
fileSystem.copyFileSync(
  path.join(dataRoot, 'sources/transit-network.json'),
  path.join(output, 'data/transit-network.json')
);
fileSystem.copyFileSync(
  path.join(dataRoot, 'sources/transport-stops.geojson'),
  path.join(output, 'data/transport-stops.geojson')
);
fileSystem.cpSync(path.join(dataRoot, 'imagery/podgorica'), path.join(output, 'data/satellite'), {
  recursive: true,
  filter: source => !source.endsWith('.md')
});
fileSystem.writeFileSync(path.join(output, '.nojekyll'), '');
execFileSync(process.execPath, [path.join(root, 'apps/web/tools/finalize.mjs')], {
  cwd: root,
  stdio: 'inherit'
});
console.log('Built deployable web artifact: dist/web/');
