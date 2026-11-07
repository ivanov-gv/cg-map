export function assertOfflineModulesIncluded(sourceModules, shell) {
  const missing = sourceModules.filter(file => file !== 'sw.js' && !shell.includes(file));
  if (missing.length) throw new Error(`Offline shell is missing runtime module(s): ${missing.join(', ')}`);
}
