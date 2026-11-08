import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import operatingSystem from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {byteRangeResponse, parseByteRange} from '../src/offline-cache.js';
import {answerQuietRequests, whenEveryWindowIsQuiet} from '../src/update-quiet.js';
import {offlineManifest, writeOfflineManifest} from '../tools/offline-manifest.mjs';

const archivePath = 'data/map.pmtiles';

function artifactDirectory(testContext) {
  const directory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'cg-map-editor-offline-'));
  testContext.after(() => fileSystem.rmSync(directory, {recursive: true, force: true}));
  fileSystem.mkdirSync(path.join(directory, 'data'));
  fileSystem.writeFileSync(path.join(directory, 'index.html'), 'page');
  fileSystem.writeFileSync(path.join(directory, 'sw.js'), 'worker');
  fileSystem.writeFileSync(path.join(directory, archivePath), 'tiles');
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
  fileSystem.writeFileSync(path.join(directory, 'index.html'), 'changed page');
  assert.notEqual(offlineManifest(directory, archivePath).release, first);
});

test('the worker carries the release, because browsers detect an update from its own bytes', testContext => {
  const directory = artifactDirectory(testContext);
  const release = writeOfflineManifest(directory, archivePath);
  assert.match(
    fileSystem.readFileSync(path.join(directory, 'sw.js'), 'utf8'),
    new RegExp(`^// Release ${release}\\.\\nworker`)
  );
  const moduleText = fileSystem.readFileSync(path.join(directory, 'offline-manifest.js'), 'utf8');
  assert.match(moduleText, new RegExp(`export const release = "${release}";`));
  assert.ok(!moduleText.includes('"sw.js"'));
});

const quietOptions = {answerMilliseconds: 50, maximumWaitMilliseconds: 2000};

test('a takeover request waits for another window that is not quiet', async testContext => {
  let isOtherWindowQuiet = false;
  const otherWindow = answerQuietRequests(() => isOtherWindowQuiet);
  testContext.after(() => otherWindow.close());
  let isFinished = false;
  const finished = whenEveryWindowIsQuiet(() => true, quietOptions).then(() => (isFinished = true));
  await delay(300);
  assert.equal(isFinished, false, 'another window was still loading its map');
  isOtherWindowQuiet = true;
  await finished;
});

test('a takeover request waits for its own window, when every other one is quiet', async testContext => {
  let isThisWindowQuiet = false;
  const otherWindow = answerQuietRequests(() => true);
  testContext.after(() => otherWindow.close());
  let isFinished = false;
  const finished = whenEveryWindowIsQuiet(() => isThisWindowQuiet, quietOptions).then(() => (isFinished = true));
  await delay(300);
  assert.equal(isFinished, false, 'this window was still loading its map');
  isThisWindowQuiet = true;
  await finished;
});

test('a window that never gets quiet cannot stop a takeover request', async () => {
  const otherWindowWaitMilliseconds = 600;
  const otherWindow = answerQuietRequests(() => false, otherWindowWaitMilliseconds);
  const startedAt = Date.now();
  await whenEveryWindowIsQuiet(() => true, {answerMilliseconds: 50, maximumWaitMilliseconds: 200});
  assert.ok(Date.now() - startedAt < otherWindowWaitMilliseconds);
  // The other window finishes its own wait first, because closing would make its answer throw.
  await delay(otherWindowWaitMilliseconds);
  otherWindow.close();
});

test('with no other window, a takeover request only waits for its own window', async () => {
  const startedAt = Date.now();
  await whenEveryWindowIsQuiet(() => true, quietOptions);
  assert.ok(Date.now() - startedAt < 1000);
});
