import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {byteRangeResponse, parseByteRange} from '../src/offline-cache.js';
import {offlineManifest, writeOfflineManifest} from '../tools/offline-manifest.mjs';

const archivePath = 'data/map.pmtiles';

function artifactDirectory(testContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-editor-offline-'));
  testContext.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.mkdirSync(path.join(directory, 'data'));
  fs.writeFileSync(path.join(directory, 'index.html'), 'page');
  fs.writeFileSync(path.join(directory, 'sw.js'), 'worker');
  fs.writeFileSync(path.join(directory, archivePath), 'tiles');
  return directory;
}

test('byte ranges follow HTTP, and an unsatisfiable one is refused', () => {
  assert.deepEqual(parseByteRange('bytes=0-3', 10), [0, 3]);
  assert.deepEqual(parseByteRange('bytes=4-', 10), [4, 9]);
  assert.deepEqual(parseByteRange('bytes=8-100', 10), [8, 9]);
  assert.deepEqual(parseByteRange('bytes=-3', 10), [7, 9]);
  assert.deepEqual(parseByteRange('bytes=-100', 10), [0, 9]);
  assert.equal(parseByteRange('bytes=10-', 10), null);
  assert.equal(parseByteRange('bytes=-0', 10), null);
  assert.equal(parseByteRange('bytes=-', 10), null);
  assert.equal(parseByteRange('items=0-1', 10), null);
});

test('a tile read returns only its bytes from the stored archive', async () => {
  const stored = () => new Response(new Blob(['0123456789'], {type: 'application/octet-stream'}));
  const partial = await byteRangeResponse(stored(), 'bytes=2-4');
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('Content-Range'), 'bytes 2-4/10');
  assert.equal(partial.headers.get('Content-Length'), '3');
  assert.equal(await partial.text(), '234');
  const whole = await byteRangeResponse(stored(), null);
  assert.equal(whole.status, 200);
  assert.equal(await whole.text(), '0123456789');
  const refused = await byteRangeResponse(stored(), 'bytes=50-');
  assert.equal(refused.status, 416);
  assert.equal(refused.headers.get('Content-Range'), 'bytes */10');
});

test('the manifest lists the archive apart, and leaves out what the browser fetches itself', testContext => {
  const directory = artifactDirectory(testContext);
  const {archive, files} = offlineManifest(directory, archivePath);
  assert.equal(archive.path, archivePath);
  assert.match(archive.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    files.map(file => file.path),
    ['index.html']
  );
});

test('any changed file makes a new release, and building twice makes the same one', testContext => {
  const directory = artifactDirectory(testContext);
  const first = offlineManifest(directory, archivePath).release;
  assert.equal(offlineManifest(directory, archivePath).release, first);
  fs.writeFileSync(path.join(directory, 'index.html'), 'changed page');
  assert.notEqual(offlineManifest(directory, archivePath).release, first);
});

test('the worker carries the release, because browsers detect an update from its own bytes', testContext => {
  const directory = artifactDirectory(testContext);
  const release = writeOfflineManifest(directory, archivePath);
  assert.match(
    fs.readFileSync(path.join(directory, 'sw.js'), 'utf8'),
    new RegExp(`^// Release ${release}\\.\\nworker`)
  );
  const moduleText = fs.readFileSync(path.join(directory, 'offline-manifest.js'), 'utf8');
  assert.match(moduleText, new RegExp(`export const release = "${release}";`));
  assert.ok(!moduleText.includes('"sw.js"'));
});
