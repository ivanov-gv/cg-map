import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('Pages entry preserves project prefix, query, and hash', () => {
  const entry = fs.readFileSync('index.html', 'utf8');
  const script = entry.match(/<script>(.*?)<\/script>/s)[1];
  for (const prefix of ['/', '/cg-map/']) {
    let target;
    const location = {href: `https://map.test${prefix}?lang=sr#place`, search: '?lang=sr', hash: '#place', replace: url => {target = url.href;}};
    vm.runInNewContext(script, {location, URL});
    assert.equal(target, `https://map.test${prefix}web/?lang=sr#place`);
  }
});

test('legacy root worker unregisters without deleting caches or verified downloads', async () => {
  const events = {}; let skipped = 0, unregistered = 0;
  const self = {skipWaiting: async () => skipped++, registration: {unregister: async () => unregistered++}, addEventListener: (name, callback) => {events[name] = callback;}};
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), {self});
  for (const name of ['install', 'activate']) {
    let promise; events[name]({waitUntil: value => {promise = value;}}); await promise;
  }
  assert.equal(skipped, 1); assert.equal(unregistered, 1);
});
