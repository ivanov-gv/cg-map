import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

test('all 16 satellite tiles match their source hashes and are available offline',()=>{
 const sample=JSON.parse(fs.readFileSync('dist/web/data/satellite/manifest.json'));
 const offline=JSON.parse(fs.readFileSync('dist/web/data/manifest.json'));
 assert.equal(sample.tiles.length,16);
 for(const tile of sample.tiles){const rel='data/satellite/'+tile.path;const bytes=fs.readFileSync('dist/web/'+rel);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),tile.sha256);assert.ok(offline.shell.includes(rel));}
 for (const shellPath of ['map-core/satellite.js', 'data/satellite/podgorica-center.webp']) {
  assert.ok(offline.shell.includes(shellPath));
 }
});
