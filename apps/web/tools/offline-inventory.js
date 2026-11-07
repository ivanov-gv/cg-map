// Throws when a runtime module under apps/web/src is missing from the offline shell, which would break offline starts.
// sw.js is the worker itself and is never part of the shell it caches.
export function assertOfflineModulesIncluded(sourceModules, shell) {
  const missing = sourceModules.filter(file => file !== 'sw.js' && !shell.includes(file));
  if (missing.length) throw new Error(`Offline shell is missing runtime module(s): ${missing.join(', ')}`);
}
