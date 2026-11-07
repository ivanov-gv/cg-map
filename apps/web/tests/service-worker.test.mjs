import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import virtualMachine from 'node:vm';
const manifest = JSON.parse(
  fileSystem.readFileSync(new URL('../../../dist/web/data/manifest.json', import.meta.url))
);
const script = fileSystem.readFileSync(new URL('../../../dist/web/sw.js', import.meta.url), 'utf8');
function createEnvironment(cached = {marker: 'cached shell'}) {
  const events = {};
  const saved = [];
  let network = 0;
  const cache = {addAll: async urls => saved.push(...urls), match: async () => cached};
  const self = {
    KOMPAS_OFFLINE: manifest,
    registration: {scope: 'https://map.test/'},
    location: {origin: 'https://map.test'},
    skipWaiting: async () => {},
    clients: {claim: async () => {}, matchAll: async () => []},
    addEventListener: (name, handler) => (events[name] = handler)
  };
  virtualMachine.runInNewContext(script, {
    self,
    importScripts: () => {},
    caches: {open: async () => cache, keys: async () => [], delete: async () => {}},
    URL,
    Request,
    Response,
    Headers,
    fetch: async () => {
      network++;
      throw new Error('Network unavailable');
    }
  });
  return {
    events,
    saved,
    cached,
    get network() {
      return network;
    }
  };
}
test('shell installation excludes the archive and partial tile requests', async () => {
  const environment = createEnvironment();
  await new Promise((resolve, reject) =>
    environment.events.install({waitUntil: promise => promise.then(resolve, reject)})
  );
  assert.ok(environment.saved.some(request => request.url.endsWith('/index.html')));
  assert.ok(environment.saved.some(request => request.url.includes('/fonts/')));
  assert.ok(
    environment.saved.every(request => !request.url.endsWith('.pmtiles') && request.cache === 'reload')
  );
});
test('range responses never enter shell-cache interception', () => {
  const environment = createEnvironment();
  let wasIntercepted = false;
  environment.events.fetch({
    request: new Request('https://map.test/' + manifest.archive.path, {headers: {Range: 'bytes=0-126'}}),
    respondWith: () => (wasIntercepted = true)
  });
  assert.equal(wasIntercepted, false);
});
test('cached shell serves without network access', async () => {
  const environment = createEnvironment();
  let promise;
  environment.events.fetch({
    request: new Request('https://map.test/app.js'),
    respondWith: promiseValue => (promise = promiseValue)
  });
  assert.equal(await promise, environment.cached);
  assert.equal(environment.network, 0);
});
test('a complete update activates and starts scoped navigation without waiting for it', async () => {
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let navigationCalls = 0;
  const events = {};
  const deleted = [];
  const self = {
    KOMPAS_OFFLINE: manifest,
    registration: {scope: 'https://map.test/cg-map/'},
    location: {origin: 'https://map.test'},
    skipWaiting: async () => skipWaitingCalls++,
    clients: {
      claim: async () => claimCalls++,
      matchAll: async () => [
        {
          url: 'https://map.test/cg-map/?lang=sr#point',
          navigate: () => {
            navigationCalls++;
            return new Promise(() => {});
          }
        },
        {
          url: 'https://map.test/other/',
          navigate: () => {
            throw new Error('Out-of-scope tab');
          }
        }
      ]
    },
    addEventListener: (eventName, handler) => (events[eventName] = handler)
  };
  virtualMachine.runInNewContext(script, {
    self,
    importScripts: () => {},
    caches: {
      open: async () => ({addAll: async () => {}}),
      keys: async () => ['kompas-shell-old', manifest.shellCache, 'unrelated-cache'],
      delete: async key => deleted.push(key)
    },
    URL,
    Request
  });
  for (const name of ['install', 'activate'])
    await new Promise((resolve, reject) =>
      events[name]({waitUntil: promise => promise.then(resolve, reject)})
    );
  assert.equal(skipWaitingCalls, 1);
  assert.equal(claimCalls, 1);
  assert.equal(navigationCalls, 1);
  assert.deepEqual(deleted, ['kompas-shell-old']);
});
test('failed shell replacement never activates or removes the working cache', async () => {
  const events = {};
  let didSkipWaiting = false;
  const self = {
    KOMPAS_OFFLINE: manifest,
    registration: {scope: 'https://map.test/'},
    skipWaiting: async () => {
      didSkipWaiting = true;
    },
    addEventListener: (eventName, handler) => (events[eventName] = handler)
  };
  virtualMachine.runInNewContext(script, {
    self,
    importScripts: () => {},
    caches: {
      open: async () => ({
        addAll: async () => {
          throw new Error('Incomplete release');
        }
      })
    },
    URL,
    Request
  });
  await assert.rejects(
    new Promise((resolve, reject) => events.install({waitUntil: promise => promise.then(resolve, reject)})),
    /Incomplete release/
  );
  assert.equal(didSkipWaiting, false);
});
test('cached redirect becomes a non-redirect response suitable for page navigation', async () => {
  const cached = new Response('<!doctype html><title>Kompas</title>', {
    headers: {'Content-Type': 'text/html', 'Content-Encoding': 'gzip', 'Content-Length': '12'}
  });
  Object.defineProperty(cached, 'redirected', {value: true});
  const environment = createEnvironment(cached);
  let promise;
  environment.events.fetch({
    request: {
      url: 'https://map.test/',
      method: 'GET',
      headers: new Headers(),
      mode: 'navigate',
      redirect: 'manual'
    },
    respondWith: promiseValue => (promise = promiseValue)
  });
  const response = await promise;
  assert.equal(response.redirected, false);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'text/html');
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal(await response.text(), '<!doctype html><title>Kompas</title>');
  assert.equal(environment.network, 0);
});
