import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelay, normalizeVehicles, UPSTREAM} from './relay.mjs';
const bus = {routeName: '6A', longitude: 19.26, latitude: 42.44};
const request = () => new Request('https://relay.test/api/vehicles');
test('provider duplicates are removed; invalid GPS and missing routes are excluded', () => {
  const features = normalizeVehicles([bus, bus, {...bus, latitude: 400}, {...bus, routeName: null}, {...bus, longitude: '19.26'}]);
  assert.equal(features.length, 1); assert.deepEqual(features[0].geometry.coordinates, [19.26, 42.44]);
  assert.equal(features[0].properties.route, '6A');
  assert.throws(() => normalizeVehicles({error: 'failed'}));
});
test('concurrent visitors share a fixed upstream fetch and a short cache', async () => {
  let calls = 0;
  const handle = createRelay({fetchImpl: async url => {assert.equal(url, UPSTREAM); calls++; return Response.json([bus]);}});
  const responses = await Promise.all([handle(request()), handle(request())]);
  await handle(request()); assert.equal(calls, 1);
  assert.equal(responses[0].headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await responses[1].json()).features.length, 1);
});
test('outages are explicitly stale then expire; recovery resumes fresh positions', async () => {
  let time = 0, fail = false;
  const handle = createRelay({now: () => time, fetchImpl: async () => {if (fail) throw Error('offline'); return Response.json([bus]);}});
  assert.equal((await handle(request())).status, 200);
  time = 14000; fail = true;
  const stale = await (await handle(request())).json(); assert.equal(stale.stale, true); assert.equal(stale.features.length, 1);
  time = 61000; assert.equal((await handle(request())).status, 503);
  fail = false; assert.equal((await (await handle(request())).json()).stale, false);
});
test('relay is read-only', async () => {
  const handle = createRelay({fetchImpl: async () => {throw Error('must not fetch');}});
  assert.equal((await handle(new Request('https://relay.test/api/vehicles', {method: 'POST'}))).status, 405);
  assert.equal((await handle(new Request('https://relay.test/api/vehicles', {method: 'OPTIONS'}))).status, 204);
});
