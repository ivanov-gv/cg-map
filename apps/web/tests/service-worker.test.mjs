import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The built worker and its manifest; npm test builds dist/web first.
const manifest = JSON.parse(fs.readFileSync(new URL('../../../dist/web/data/manifest.json', import.meta.url)));
const script = fs.readFileSync(new URL('../../../dist/web/sw.js', import.meta.url), 'utf8');

// Runs the worker script against fake globals and returns its event handlers by name.
function runWorker({scope = 'https://map.test/', clients, caches, fetch, skipWaiting = async () => {}}) {
  const events = {};
  const self = {
    KOMPAS_OFFLINE: manifest,
    registration: {scope},
    location: {origin: 'https://map.test'},
    skipWaiting,
    clients,
    addEventListener: (name, handler) => {
      events[name] = handler;
    }
  };
  vm.runInNewContext(script, {self, importScripts: () => {}, caches, URL, Request, Response, Headers, fetch});
  return events;
}

// Resolves when the lifecycle event's waitUntil promise settles.
const dispatchLifecycle = (events, name) =>
  new Promise((resolve, reject) => events[name]({waitUntil: promise => promise.then(resolve, reject)}));

// Returns what the worker answered with, or undefined when it let the request through.
function dispatchFetch(events, request) {
  let response;
  events.fetch({request, respondWith: promise => (response = promise)});
  return response;
}

// An installed worker whose shell cache holds cached; every network request fails and is counted.
function setup(cached = {marker: 'cached shell'}) {
  const saved = [];
  let networkRequests = 0;
  const cache = {addAll: async requests => saved.push(...requests), match: async () => cached};
  const events = runWorker({
    clients: {claim: async () => {}, matchAll: async () => []},
    caches: {open: async () => cache, keys: async () => [], delete: async () => {}},
    fetch: async () => {
      networkRequests++;
      throw new Error('Network unavailable');
    }
  });
  return {
    events,
    saved,
    cached,
    get networkRequests() {
      return networkRequests;
    }
  };
}

test('shell installation excludes the archive and partial tile requests', async () => {
  const worker = setup();
  await dispatchLifecycle(worker.events, 'install');
  assert.ok(worker.saved.some(request => request.url.endsWith('/index.html')));
  assert.ok(worker.saved.some(request => request.url.includes('/fonts/')));
  assert.ok(worker.saved.every(request => !request.url.endsWith('.pmtiles') && request.cache === 'reload'));
});

test('range responses never enter shell-cache interception', () => {
  const worker = setup();
  const rangeRequest = new Request('https://map.test/' + manifest.archive.path, {headers: {Range: 'bytes=0-126'}});
  assert.equal(dispatchFetch(worker.events, rangeRequest), undefined);
});

test('cached shell serves without network access', async () => {
  const worker = setup();
  const response = dispatchFetch(worker.events, new Request('https://map.test/app.js'));
  assert.equal(await response, worker.cached);
  assert.equal(worker.networkRequests, 0);
});

test('a complete update activates and starts scoped navigation without waiting for it', async () => {
  let skipped = 0;
  let claimed = 0;
  let navigated = 0;
  const deleted = [];
  const windows = [
    {
      url: 'https://map.test/cg-map/?lang=sr#point',
      navigate: () => {
        navigated++;
        return new Promise(() => {});
      }
    },
    {
      url: 'https://map.test/other/',
      navigate: () => {
        throw new Error('Out-of-scope tab');
      }
    }
  ];
  const events = runWorker({
    scope: 'https://map.test/cg-map/',
    skipWaiting: async () => skipped++,
    clients: {claim: async () => claimed++, matchAll: async () => windows},
    caches: {
      open: async () => ({addAll: async () => {}}),
      keys: async () => ['kompas-shell-old', manifest.shellCache, 'unrelated-cache'],
      delete: async key => deleted.push(key)
    }
  });
  await dispatchLifecycle(events, 'install');
  await dispatchLifecycle(events, 'activate');
  assert.equal(skipped, 1);
  assert.equal(claimed, 1);
  assert.equal(navigated, 1);
  assert.deepEqual(deleted, ['kompas-shell-old']);
});

test('failed shell replacement never activates or removes the working cache', async () => {
  let skipped = false;
  const events = runWorker({
    skipWaiting: async () => {
      skipped = true;
    },
    caches: {
      open: async () => ({
        addAll: async () => {
          throw new Error('Incomplete release');
        }
      })
    }
  });
  await assert.rejects(dispatchLifecycle(events, 'install'), /Incomplete release/);
  assert.equal(skipped, false);
});

test('cached redirect becomes a non-redirect response suitable for page navigation', async () => {
  const page = '<!doctype html><title>Kompas</title>';
  const cached = new Response(page, {
    headers: {'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': '12'}
  });
  Object.defineProperty(cached, 'redirected', {value: true});
  const worker = setup(cached);
  const navigation = {url: 'https://map.test/', method: 'GET', headers: new Headers(), mode: 'navigate', redirect: 'manual'};
  const response = await dispatchFetch(worker.events, navigation);
  assert.equal(response.redirected, false);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html');
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(await response.text(), page);
  assert.equal(worker.networkRequests, 0);
});
