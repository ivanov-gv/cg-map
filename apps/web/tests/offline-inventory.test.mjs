import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import {assertOfflineModulesIncluded} from '../tools/offline-inventory.js';

test('offline shell includes each browser module and deliberately excludes the service worker', () => {
  const sourceModules = fileSystem
    .readdirSync(new URL('../src/', import.meta.url))
    .filter(file => file.endsWith('.js'));
  const manifest = JSON.parse(
    fileSystem.readFileSync(new URL('../../../dist/web/data/manifest.json', import.meta.url), 'utf8')
  );
  assertOfflineModulesIncluded(sourceModules, manifest.shell);
  assert.ok(!manifest.shell.includes('sw.js'));
});

test('offline module check reports a missing runtime module but exempts the service worker', () => {
  assert.doesNotThrow(() => assertOfflineModulesIncluded(['app.js', 'sw.js'], ['app.js']));
  assert.throws(
    () => assertOfflineModulesIncluded(['app.js', 'new-module.js', 'sw.js'], ['app.js']),
    /new-module\.js/
  );
});
