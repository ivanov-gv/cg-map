// Assembles dist/core-demo from this app's own files and the map-core build contract.
import {fileURLToPath} from 'node:url';
import {assembleStaticApplication} from '../../../packages/map-core/tools/assemble.mjs';

assembleStaticApplication(fileURLToPath(new URL('..', import.meta.url)));
console.log('Built dist/core-demo/');
