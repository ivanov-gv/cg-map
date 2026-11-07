import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {ArchiveSource} from '../src/offline.js';
const payload = new TextEncoder().encode('a complete verified vector archive');
const hash = crypto.createHash('sha256').update(payload).digest('hex');
function setup({badHash = false, failFinalRead = false} = {}) {
  const files = new Map([['map-old.pmtiles', new Blob(['old map'])]]);
  const storage = new Map([['kompas-active-map', 'map-old.pmtiles']]);
  let remoteReads = 0;
  const directory = {
    async getFileHandle(name, {create = false} = {}) {
      if (!create && !files.has(name)) throw new Error('Missing file');
      return {
        getFile: async () => {
          if (failFinalRead && name.endsWith('.pmtiles') && name !== 'map-old.pmtiles') {
            throw new Error('Completed file cannot be reopened');
          }
          return files.get(name);
        },
        async createWritable() {
          const chunks = [];
          const stream = new WritableStream({
            write(chunk) {
              chunks.push(chunk);
            },
            close() {
              files.set(name, new Blob(chunks));
            }
          });
          stream.write = async value => {
            const writer = stream.getWriter();
            try {
              await writer.write(value);
            } finally {
              writer.releaseLock();
            }
          };
          stream.close = async () => {
            const writer = stream.getWriter();
            try {
              await writer.close();
            } finally {
              writer.releaseLock();
            }
          };
          return stream;
        }
      };
    },
    async removeEntry(name) {
      files.delete(name);
    }
  };
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
    archive: {bytes: payload.length, sha256: badHash ? '0'.repeat(64) : hash},
    shell: ['index.html'],
    shellCache: 'test-shell'
  };
  return {
    files,
    storage,
    manifest,
    source: new ArchiveSource('https://kompas.test/map.pmtiles', manifest),
    get remoteReads() {
      return remoteReads;
    }
  };
}
test('verified download activates and subsequent reads use local file slices', async () => {
  const environment = setup();
  await environment.source.init();
  const result = await environment.source.download(new AbortController().signal, () => {});
  assert.equal(result.persisted, true);
  assert.equal(environment.storage.get('kompas-active-map'), environment.source.filename);
  assert.equal(environment.files.has('map-old.pmtiles'), false);
  const read = await environment.source.getBytes(2, 6);
  assert.equal(new TextDecoder().decode(read.data), 'comple');
  assert.equal(environment.remoteReads, 0);
  assert.equal(environment.files.has(environment.source.filename + '.partial'), false);
});
test('integrity failure preserves previous map and activation marker', async () => {
  const environment = setup({badHash: true});
  await environment.source.init();
  await assert.rejects(
    environment.source.download(new AbortController().signal, () => {}),
    /integrity/
  );
  assert.equal(environment.storage.get('kompas-active-map'), 'map-old.pmtiles');
  assert.equal(await environment.files.get('map-old.pmtiles').text(), 'old map');
  assert.equal(environment.source.local, null);
  assert.equal(environment.files.has(environment.source.filename + '.partial'), false);
});
test('cancelled download never activates partial data', async () => {
  const environment = setup();
  await environment.source.init();
  const abort = new AbortController();
  await assert.rejects(
    environment.source.download(abort.signal, () => abort.abort()),
    {name: 'AbortError'}
  );
  assert.equal(environment.storage.get('kompas-active-map'), 'map-old.pmtiles');
  assert.equal(environment.files.has(environment.source.filename + '.partial'), false);
});
test('fresh instance reopens a completed package without network reads', async () => {
  const environment = setup();
  await environment.source.init();
  await environment.source.download(new AbortController().signal, () => {});
  const restored = new ArchiveSource('https://kompas.test/map.pmtiles', environment.manifest);
  assert.equal(await restored.init(), true);
  const read = await restored.getBytes(0, payload.length);
  assert.equal(new TextDecoder().decode(read.data), new TextDecoder().decode(payload));
  assert.equal(environment.remoteReads, 0);
});

test('failure reopening a completed replacement preserves the previous activation', async () => {
  const environment = setup({failFinalRead: true});
  await environment.source.init();
  await assert.rejects(
    environment.source.download(new AbortController().signal, () => {}),
    /Completed file cannot be reopened/
  );
  assert.equal(environment.storage.get('kompas-active-map'), 'map-old.pmtiles');
  assert.equal(await environment.files.get('map-old.pmtiles').text(), 'old map');
  assert.equal(environment.source.local, null);
  assert.equal(environment.files.has(environment.source.filename + '.partial'), false);
});
