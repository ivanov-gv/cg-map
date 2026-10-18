import test from 'node:test';
import assert from 'node:assert/strict';
import {TransportFeed, validTransportFeed} from '../src/transport.js';
const stamp = '2026-10-18T18:00:00Z';
const now = Date.parse(stamp);
const snapshot = () => ({type: 'FeatureCollection', fetchedAt: stamp, stale: false, features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A'}}]});
function setup(fetchImpl, clock = () => now) {
  const statuses = [], updates = [], timers = new Map(); let id = 0;
  const map = {getSource: () => ({setData: data => updates.push(data)}), setLayoutProperty: () => {}};
  const feed = new TransportFeed(map, {fetchImpl, now: clock, onStatus: state => statuses.push(state), schedule: callback => {timers.set(++id, callback);return id;}, cancel: key => timers.delete(key)});
  return {feed, statuses, updates, timers};
}
test('transport feed rejects expired timestamps and invalid GPS', () => {
  assert.equal(validTransportFeed(snapshot(), now).features.length, 1);
  assert.throws(() => validTransportFeed(snapshot(), now + 61000));
  const bad = snapshot(); bad.features[0].geometry.coordinates[0] = 0;
  assert.throws(() => validTransportFeed(bad, now));
});
test('late responses cannot restore disabled transport or restart polling', async () => {
  let resolve;
  const env = setup(() => new Promise(done => {resolve = done;}));
  const pending = env.feed.setEnabled(true); env.feed.setEnabled(false);
  resolve(Response.json(snapshot())); await pending;
  assert.equal(env.statuses.at(-1).state, 'off'); assert.equal(env.updates.at(-1).features.length, 0);assert.equal(env.timers.size, 0);
});
test('failed refresh shows stale positions briefly, then removes expired buses', async () => {
  let fail = false, time = now;
  const env = setup(async () => {if (fail) throw Error('network');return Response.json(snapshot());}, () => time);
  await env.feed.setEnabled(true); assert.equal(env.statuses.at(-1).state, 'live');
  fail = true; time += 14000; await env.feed.refresh(); assert.equal(env.statuses.at(-1).state, 'stale');
  time += 60000; await env.feed.refresh(); assert.equal(env.statuses.at(-1).state, 'unavailable'); assert.equal(env.updates.at(-1).features.length, 0);
  env.feed.pause();assert.equal(env.timers.size, 0); assert.equal(env.statuses.at(-1).state, 'offline');
});
