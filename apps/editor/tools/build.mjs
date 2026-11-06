// Assembles dist/editor from this app's own files, the map-core build contract and the data-owned source bundle.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeEditorBundle} from '../../../data/tools/editor-bundle.mjs';
import {assembleStaticApplication} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {copyMapData, readVerifiedRelease} from '../../../data/tools/app-data.mjs';
import {writeOfflineManifest} from './offline-manifest.mjs';

const outputDirectory = fileURLToPath(new URL('../../../dist/editor/', import.meta.url));
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory);
const sourceDirectory = fileURLToPath(new URL('../../../data/sources/', import.meta.url));
await writeEditorBundle(sourceDirectory, path.join(outputDirectory, 'sources'));
// The editing rules are a shared contract: the importer reads the same file.
fs.copyFileSync(
  fileURLToPath(new URL('../../../packages/contracts/editor-layers.json', import.meta.url)),
  path.join(outputDirectory, 'data/editor-layers.json')
);
// Last, because the manifest hashes every other file in the artifact.
const {release} = readVerifiedRelease();
const offlineRelease = writeOfflineManifest(outputDirectory, `data/${release.archive.file}`);
console.log(`Built dist/editor/ (release ${offlineRelease})`);
