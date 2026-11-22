// Assembles dist/core-demo from this app's own files and the map-core build contract.
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {assembleStaticApplication} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {resolveContractsRoot} from './contracts-root.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../../../dist/core-demo/', import.meta.url));
// Dev builds use HEAD; a future app production release pins every dependency. Test targets set both roots to the pinned
// data and contracts packages.
function resolveDataRoot(defaultRoot) {
  if ('MAP_DATA_ROOT' in process.env && !process.env.MAP_DATA_ROOT) {
    throw new Error('MAP_DATA_ROOT is set but empty; test targets must resolve the pinned @ivanov-gv/map-data package');
  }
  return process.env.MAP_DATA_ROOT ? path.resolve(process.env.MAP_DATA_ROOT) : defaultRoot;
}

const dataRoot = resolveDataRoot(path.join(repositoryRoot, 'data'));
const contractsRoot = resolveContractsRoot();
const dataToolsURL = pathToFileURL(path.join(dataRoot, 'tools/app-data.mjs')).href;
const {copyMapData} = await import(dataToolsURL);
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory, {
  dataRoot,
  contractPath: path.join(contractsRoot, 'place-visibility.json')
});
console.log('Built dist/core-demo/');
