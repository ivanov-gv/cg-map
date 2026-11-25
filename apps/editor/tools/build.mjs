// Assembles dist/editor from this app's own files, the map-core build contract and the data-owned source bundle.
import fileSystem from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {describeInputs} from './build-inputs.mjs';
import {resolveContractsRoot} from './contracts-root.mjs';
import {importCoreModule, resolveCoreRoot} from './core-root.mjs';
import {writeOfflineManifest} from './offline-manifest.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../dist/editor/', import.meta.url));
// A build that is not a release takes every package from its own commit. Release and test targets set the roots to the
// packages this app pins.
function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}

const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'));
const contractsRoot = resolveContractsRoot();
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const editorBundleURL = pathToFileURL(path.join(dataRoot, 'tools/editor-bundle.mjs')).href;
const {assembleStaticApplication} = await importCoreModule('tools/assemble.mjs');
const {copyMapData, readVerifiedRelease} = await import(dataToolsURL);
const {writeEditorBundle} = await import(editorBundleURL);
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory, {
  dataRoot,
  contractPath: path.join(contractsRoot, 'place-visibility.json')
});
await writeEditorBundle(
  path.join(dataRoot, 'sources'),
  path.join(outputDirectory, 'sources'),
  path.join(contractsRoot, 'editor-bundle.schema.json')
);
// The editing rules are a shared contract: the importer reads the same file.
fileSystem.copyFileSync(
  path.join(contractsRoot, 'editor-layers.json'),
  path.join(outputDirectory, 'data/editor-layers.json')
);
// Last, because the manifest hashes every other file in the artifact.
const {release} = readVerifiedRelease(dataRoot);
const offlineRelease = writeOfflineManifest(outputDirectory, `data/${release.archive.file}`);
const inputs = describeInputs({core: resolveCoreRoot(), data: dataRoot, contracts: contractsRoot});
console.log(`Built dist/editor/ (release ${offlineRelease}; ${inputs})`);
