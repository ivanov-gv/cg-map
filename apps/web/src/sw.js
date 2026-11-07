/* Shell only: PMTiles byte ranges are handled by the archive reader, never cached as full responses. */
importScripts('offline-manifest.js');
const config = self.KOMPAS_OFFLINE;

// A followed redirect cannot satisfy Chrome's redirect:manual navigation. Rebuild from the decoded
// body, preserving content type but removing the original wire encoding and length.
function navigationSafeResponse(response) {
  if (!response?.redirected) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Encoding');
  headers.delete('Content-Length');
  return new Response(response.body, {status: response.status, statusText: response.statusText, headers});
}

// Fetch the complete replacement before taking over. A failed addAll keeps the old worker active.
async function installShell() {
  const cache = await caches.open(config.shellCache);
  const requests = config.shell.map(assetPath => {
    return new Request(new URL(assetPath, self.registration.scope), {cache: 'reload'});
  });
  await cache.addAll(requests);
  await self.skipWaiting();
}

// Start scoped navigations after claiming clients, without awaiting them: their fetches wait for
// activation to finish. First installation leaves the current pages alone.
async function activateShell() {
  const cacheNames = await caches.keys();
  const isObsoleteShell = name => name.startsWith('kompas-shell-') && name !== config.shellCache;
  const isUpgrading = cacheNames.some(isObsoleteShell);
  const windows = isUpgrading ? await self.clients.matchAll({type: 'window', includeUncontrolled: true}) : [];
  for (const name of cacheNames) {
    if (isObsoleteShell(name)) await caches.delete(name);
  }
  await self.clients.claim();
  for (const client of windows) {
    if (!client.url.startsWith(self.registration.scope)) continue;
    // A tab may close between enumeration and navigation; it must not fail activation.
    void client.navigate(client.url).catch(() => {});
  }
}

// Only the declared shell is served from cache; unknown requests never become offline assets.
async function shellResponse(request) {
  const cache = await caches.open(config.shellCache);
  const cached = await cache.match(request);
  if (cached) return navigationSafeResponse(cached);
  if (request.mode === 'navigate') {
    const index = await cache.match(new URL('index.html', self.registration.scope));
    return index ? navigationSafeResponse(index) : fetch(request);
  }
  return fetch(request);
}

self.addEventListener('install', event => event.waitUntil(installShell()));
self.addEventListener('activate', event => event.waitUntil(activateShell()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const isOwnRead =
    request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.href.startsWith(self.registration.scope);
  const isArchiveRead = request.headers.has('Range') || url.pathname.endsWith('.pmtiles');
  if (!isOwnRead || isArchiveRead) return;
  event.respondWith(shellResponse(request));
});
