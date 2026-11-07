/* Shell only: PMTiles byte ranges are handled by the archive reader, never cached as full responses. */
importScripts('offline-manifest.js');
const config = self.KOMPAS_OFFLINE;
const shellCachePrefix = 'kompas-shell-';

function navigationSafeResponse(response) {
  if (!response?.redirected) return response;
  // A followed redirect cannot satisfy Chrome's redirect:manual navigation.
  // Rebuild from the decoded body; preserve content type but not wire encoding.
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

async function installShell() {
  const cache = await caches.open(config.shellCache);
  // Bypass the browser HTTP cache when installing a new release.
  const requests = config.shell.map(path => new Request(new URL(path, self.registration.scope), {cache: 'reload'}));
  await cache.addAll(requests);
  await self.skipWaiting();
}

async function activateShell() {
  const keys = await caches.keys();
  const olderShells = keys.filter(key => key.startsWith(shellCachePrefix) && key !== config.shellCache);
  const isUpgrade = olderShells.length > 0;
  const windows = isUpgrade ? await self.clients.matchAll({type: 'window', includeUncontrolled: true}) : [];
  for (const key of olderShells) await caches.delete(key);
  await self.clients.claim();
  // Do not await navigation inside activation: its fetch waits for activation
  // to finish. Initiating it here also updates tabs running older app code.
  for (const client of windows) {
    if (client.url.startsWith(self.registration.scope)) client.navigate(client.url).catch(() => {});
  }
}

// Only same-scope GET requests for whole files; archive reads and range requests go to the network untouched.
function isShellRequest(request) {
  const url = new URL(request.url);
  const isInScope = url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
  const isArchiveRead = request.headers.has('Range') || url.pathname.endsWith('.pmtiles');
  return request.method === 'GET' && isInScope && !isArchiveRead;
}

async function shellResponse(request) {
  const cache = await caches.open(config.shellCache);
  const cached = await cache.match(request);
  if (cached) return navigationSafeResponse(cached);
  if (request.mode === 'navigate') {
    const index = await cache.match(new URL('index.html', self.registration.scope));
    return index ? navigationSafeResponse(index) : fetch(request);
  }
  // No catch-all cache: external links and unknown requests never become offline assets.
  return fetch(request);
}

self.addEventListener('install', event => event.waitUntil(installShell()));
self.addEventListener('activate', event => event.waitUntil(activateShell()));
self.addEventListener('fetch', event => {
  if (!isShellRequest(event.request)) return;
  event.respondWith(shellResponse(event.request));
});
