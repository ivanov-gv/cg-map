// Retire the old /web/-scoped worker after Actions deploys the app at /.
// Preserve origin-wide caches and verified OPFS downloads used by the new app.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
