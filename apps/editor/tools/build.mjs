// Assembles dist/editor from this app's own files, the map-core build contract and the data-owned source bundle.
import fileSystem from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assembleStaticApplication} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {writeOfflineManifest} from './offline-manifest.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../dist/editor/', import.meta.url));
// Dev builds use HEAD; a future app production release pins every dependency. Test targets set MAP_DATA_ROOT to the
// pinned package, tools included.
function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}

const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'));
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const editorBundleURL = pathToFileURL(path.join(dataRoot, 'tools/editor-bundle.mjs')).href;
const {copyMapData, readVerifiedRelease} = await import(dataToolsURL);
const {writeEditorBundle} = await import(editorBundleURL);
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory, {
  dataRoot,
  contractPath: fileURLToPath(import.meta.resolve('@ivanov-gv/map-contracts/place-visibility.json'))
});
const editorBundleContractURL = new URL(import.meta.resolve('@ivanov-gv/map-contracts/editor-bundle.schema.json'));
await writeEditorBundle(
  path.join(dataRoot, 'sources'),
  path.join(outputDirectory, 'sources'),
  editorBundleContractURL
);
// The editing rules are a shared contract: the importer reads the same file.
fileSystem.copyFileSync(
  fileURLToPath(import.meta.resolve('@ivanov-gv/map-contracts/editor-layers.json')),
  path.join(outputDirectory, 'data/editor-layers.json')
);
// Last, because the manifest hashes every other file in the artifact.
const {release} = readVerifiedRelease(dataRoot);
const offlineRelease = writeOfflineManifest(outputDirectory, `data/${release.archive.file}`);
console.log(`Built dist/editor/ (release ${offlineRelease})`);
