// Assembles dist/core-demo from this app's own files, the map-core build contract and the data-owned source bundle.
import {copyFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {importCoreModule, resolveCoreRoot} from './core-root.mjs';
import {resolveContractsRoot} from './contracts-root.mjs';
import {resolveDataRoot} from './data-root.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../dist/core-demo/', import.meta.url));
// A build that is not a release takes core, data and contracts from its own commit. Test targets and a release use the
// pins this app declares; CORE_DEMO_RELEASE marks the release invocation so another root cannot be substituted.
const releaseBuild = process.env.CORE_DEMO_RELEASE === '1';
const coreRoot = resolveCoreRoot({release: releaseBuild});
const {assembleStaticApplication} = await importCoreModule('tools/assemble.mjs', coreRoot);
const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'), {release: releaseBuild});
const contractsRoot = resolveContractsRoot();
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const {copyMapData} = await import(dataToolsURL);
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory, {
  dataRoot,
  contractPath: path.join(contractsRoot, 'place-visibility.json')
});
// The demo resolves version-5 POIs from the same data-owned policy that assigns levels to published places.
copyFileSync(
  path.join(dataRoot, 'sources', 'place-visibility-policy.json'),
  path.join(outputDirectory, 'data', 'place-visibility-policy.json')
);
console.log(`Built dist/core-demo/ (core from ${coreRoot})`);
