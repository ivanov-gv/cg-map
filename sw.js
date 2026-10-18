// Migration only: retire the previous root-scoped worker. The application now
// owns web/sw.js with scope web/. Do not clear origin-wide caches or OPFS here:
// the new worker and verified offline archives may already be using them.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
