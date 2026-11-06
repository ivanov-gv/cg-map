// Assembles dist/core-demo from this app's own files and the map-core build contract.
import {fileURLToPath} from 'node:url';
import {assembleStaticApplication} from '@ivanov-gv/map-core/tools/assemble.mjs';
import {copyMapData} from '../../../data/tools/app-data.mjs';

const outputDirectory = fileURLToPath(new URL('../../../dist/core-demo/', import.meta.url));
assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)), outputDirectory);
copyMapData(outputDirectory);
console.log('Built dist/core-demo/');
