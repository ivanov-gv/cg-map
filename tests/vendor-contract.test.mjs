import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the actual browser bundles, rather than trusting package typings or mocks.
const context={console,setTimeout,clearTimeout,TextEncoder,TextDecoder,performance};
for(const file of ['maplibre-gl.js','pmtiles.js'])vm.runInNewContext(fs.readFileSync('web/vendor/'+file,'utf8'),context,{filename:file});
test('every vendor entry point used by the application exists in the shipped bundles',()=>{
 const source=['app.js','offline.js'].map(f=>fs.readFileSync('web/'+f,'utf8')).join('\n');
 for(const match of source.matchAll(/\b(maplibregl|pmtiles)\.([A-Za-z_$][\w$]*)/g)){
  assert.equal(typeof context[match[1]]?.[match[2]],'function',`${match[1]}.${match[2]} is unavailable in the shipped bundle`);
 }
});
