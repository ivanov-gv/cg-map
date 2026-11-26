import fileSystem from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {copyMapCore, copyRuntimeAssets} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {parseVisibilityConfig, assertPublishedPlaces} from '@ivanov-gv/map-core/src/place-visibility.js';
import {resolveContractsRoot} from './contracts-root.mjs';
import {resolveDataRoot} from './data-root.mjs';
import {copyRuntimeSource, findRuntimeModules} from './runtime-modules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const output = path.join(root, 'dist/web');
const source = path.join(root, 'apps/web/src');
const publishedCorePackage = '@ivanov-gv/map-core';
const publishedCoreSourcePrefix = `${publishedCorePackage}/src/`;
// Import specifiers, not every quoted string: a module's sibling path and an asset URL must keep their own meaning.
const publishedCoreImportPattern = /(\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?)(['"])(@ivanov-gv\/map-core(?:\/src\/[^'"]*)?)\2/g;

// Browsers cannot resolve the published package name, so each import becomes relative to its own artifact depth.
function relocatePublishedCoreImports(sourceText, corePrefix) {
  return sourceText.replace(publishedCoreImportPattern, (_match, beforeSpecifier, quote, specifier) => {
    const relativeSpecifier =
      specifier === publishedCorePackage
        ? `${corePrefix}/index.js`
        : `${corePrefix}/${specifier.slice(publishedCoreSourcePrefix.length)}`;
    return `${beforeSpecifier}${quote}${relativeSpecifier}${quote}`;
  });
}
// Dev builds default to the repository's HEAD; a future app production release pins every dependency, data included.
// Test targets set MAP_DATA_ROOT and MAP_CONTRACTS_ROOT, so tools and contracts come from the pinned releases.
const dataRoot = resolveDataRoot(path.join(root, 'data'));
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const {readVerifiedRelease} = await import(dataToolsURL);
const {release, archiveBytes} = readVerifiedRelease(dataRoot);
fileSystem.rmSync(output, {recursive: true, force: true});
fileSystem.cpSync(path.join(root, 'apps/web/public'), output, {recursive: true});
copyRuntimeSource(source, output);
copyMapCore(output);
copyRuntimeAssets(output);
const coreDirectory = path.join(output, 'map-core');
for (const modulePath of findRuntimeModules(source)) {
  const destination = path.join(output, modulePath);
  const relativeCore = path.relative(path.dirname(destination), coreDirectory).split(path.sep).join('/');
  const corePrefix = relativeCore.startsWith('.') ? relativeCore : `./${relativeCore}`;
  // A package name has no browser meaning; each published import must reach the core copy at this module's depth.
  const relocated = relocatePublishedCoreImports(fileSystem.readFileSync(destination, 'utf8'), corePrefix);
  fileSystem.writeFileSync(destination, relocated);
}
fileSystem.mkdirSync(path.join(output, 'data'), {recursive: true});
fileSystem.writeFileSync(path.join(output, 'data', release.archive.file), archiveBytes);
const places = JSON.parse(fileSystem.readFileSync(path.join(dataRoot, 'sources/places.geojson')));
// Dev builds resolve contracts at HEAD; test targets override the root with this app's pin.
const contractsRoot = resolveContractsRoot();
const visibilityContractPath = path.join(contractsRoot, 'place-visibility.json');
const visibilityConfig = JSON.parse(fileSystem.readFileSync(visibilityContractPath));
assertPublishedPlaces(places.features, parseVisibilityConfig(visibilityConfig));
fileSystem.copyFileSync(
  path.join(dataRoot, 'sources/places.geojson'),
  path.join(output, 'data/places.geojson')
);
fileSystem.copyFileSync(visibilityContractPath, path.join(output, 'data/place-visibility.json'));
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
