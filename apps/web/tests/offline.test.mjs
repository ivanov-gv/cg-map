import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ArchiveSource} from '../src/offline.js';

const payload = new TextEncoder().encode('a complete verified vector archive');
const payloadHash = crypto.createHash('sha256').update(payload).digest('hex');
const archiveURL = 'https://kompas.test/map.pmtiles';
const activeMapKey = 'kompas-active-map';

// A writable that collects chunks and stores them as the file on close, with the write/close shortcuts that
// FileSystemWritableFileStream adds to a WritableStream.
function fakeWritable(files, name) {
  const chunks = [];
  const stream = new WritableStream({
    write(chunk) {
      chunks.push(chunk);
    },
    close() {
      files.set(name, new Blob(chunks));
    }
  });
  const withWriter = async action => {
    const writer = stream.getWriter();
    try {
      await action(writer);
    } finally {
      writer.releaseLock();
    }
  };
  stream.write = value => withWriter(writer => writer.write(value));
  stream.close = () => withWriter(writer => writer.close());
  return stream;
}

// An origin-private directory backed by a Map of name -> Blob.
function fakeDirectory(files) {
  return {
    async getFileHandle(name, {create = false} = {}) {
      if (!create && !files.has(name)) throw new Error('Missing file');
      return {
        getFile: async () => files.get(name),
        createWritable: async () => fakeWritable(files, name)
      };
    },
    async removeEntry(name) {
      files.delete(name);
    }
  };
}

// A browser with an older verified download active. badHash makes the manifest disagree with the served archive.
function setup({badHash = false} = {}) {
  const files = new Map([['map-old.pmtiles', new Blob(['old map'])]]);
  const storage = new Map([[activeMapKey, 'map-old.pmtiles']]);
  let remoteReads = 0;
  const directory = fakeDirectory(files);
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      storage: {
        getDirectory: async () => directory,
        estimate: async () => ({quota: 1e9, usage: 1}),
        persist: async () => true
      }
    }
  });
  globalThis.location = {href: 'https://kompas.test/'};
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  globalThis.pmtiles = {
    FetchSource: class {
      async getBytes() {
        remoteReads++;
        return {data: payload.buffer};
      }
    }
  };
  globalThis.caches = {open: async () => ({put: async () => {}})};
  globalThis.fetch = async url => new Response(String(url).endsWith('.pmtiles') ? payload : 'app shell');
  const manifest = {
    archive: {bytes: payload.length, sha256: badHash ? '0'.repeat(64) : payloadHash},
    shell: ['index.html'],
    shellCache: 'test-shell'
  };
  return {
    files,
    storage,
    manifest,
    source: new ArchiveSource(archiveURL, manifest),
    get remoteReads() {
      return remoteReads;
    }
  };
}

const download = (source, onProgress = () => {}) => source.download(new AbortController().signal, onProgress);
const decode = bytes => new TextDecoder().decode(bytes);

test('verified download activates and subsequent reads use local file slices', async () => {
  const browser = setup();
  await browser.source.init();
  const result = await download(browser.source);
  assert.equal(result.persisted, true);
  assert.equal(browser.storage.get(activeMapKey), browser.source.filename);
  assert.equal(browser.files.has('map-old.pmtiles'), false);
  const read = await browser.source.getBytes(2, 6);
  assert.equal(decode(read.data), 'comple');
  assert.equal(browser.remoteReads, 0);
  assert.equal(browser.files.has(browser.source.filename + '.partial'), false);
});

test('integrity failure preserves previous map and activation marker', async () => {
  const browser = setup({badHash: true});
  await browser.source.init();
  await assert.rejects(download(browser.source), /integrity/);
  assert.equal(browser.storage.get(activeMapKey), 'map-old.pmtiles');
  assert.equal(await browser.files.get('map-old.pmtiles').text(), 'old map');
  assert.equal(browser.source.local, null);
  assert.equal(browser.files.has(browser.source.filename + '.partial'), false);
});

test('cancelled download never activates partial data', async () => {
  const browser = setup();
  await browser.source.init();
  const controller = new AbortController();
  await assert.rejects(
    browser.source.download(controller.signal, () => controller.abort()),
    {name: 'AbortError'}
  );
  assert.equal(browser.storage.get(activeMapKey), 'map-old.pmtiles');
  assert.equal(browser.files.has(browser.source.filename + '.partial'), false);
});

test('fresh instance reopens a completed package without network reads', async () => {
  const browser = setup();
  await browser.source.init();
  await download(browser.source);
  const restored = new ArchiveSource(archiveURL, browser.manifest);
  assert.equal(await restored.init(), true);
  const read = await restored.getBytes(0, payload.length);
  assert.equal(decode(read.data), decode(payload));
  assert.equal(browser.remoteReads, 0);
});
