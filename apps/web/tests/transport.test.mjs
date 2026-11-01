import test from 'node:test';
import assert from 'node:assert/strict';
import {TransportFeed, validTransportFeed} from '../src/transport.js';
const stamp = '2026-10-18T18:00:00Z';
const now = Date.parse(stamp);
const snapshot = () => ({type: 'FeatureCollection', fetchedAt: stamp, stale: false, features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A'}}]});
const network = {stops: {a: {coordinates: [19.26, 42.43]}, b: {coordinates: [19.26, 42.45]}}, patterns: [{route: '6A', stops: ['a', 'b']}]};
// Answers the route network request itself, so tests see only vehicle feed requests.
function setup(feedImpl, clock = () => now, options = {}) {
  const statuses = [], updates = [], timers = new Map(), requests = []; let id = 0;
  const map = {getSource: () => ({setData: data => updates.push(data)}), setLayoutProperty: () => {}};
  const fetchImpl = (url, init) => url === 'data/transit-network.json' ? Promise.resolve(Response.json(network)) : (requests.push(url), feedImpl(url, init));
  const feed = new TransportFeed(map, {...options, fetchImpl, now: clock, onStatus: state => statuses.push(state), schedule: callback => {timers.set(++id, callback);return id;}, cancel: key => timers.delete(key)});
  return {feed, statuses, updates, timers, requests};
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
test('feed reads the configured URL and gives every bus a direction', async () => {
  let time = now, step = 0;
  const env = setup(async () => {
    const data = snapshot(); data.fetchedAt = new Date(time).toISOString();
    data.features[0].geometry.coordinates = [19.26 + step * 0.002, 42.44];
    return Response.json(data);
  }, () => time, {url: 'https://maps.example.com/api/v1/transport/vehicles'});
  await env.feed.setEnabled(true);
  assert.deepEqual(env.requests, ['https://maps.example.com/api/v1/transport/vehicles']);
  let bus = env.updates.at(-1).features[0].properties;
  assert.equal(bus.heading, 'route'); assert.ok(Math.abs(bus.bearing) < 1, 'estimated along route 6A (north)');
  step = 1; time += 13000; await env.feed.refresh();
  bus = env.updates.at(-1).features[0].properties;
  assert.equal(bus.heading, 'movement'); assert.ok(Math.abs(bus.bearing - 90) < 1, 'moved east');
  env.feed.setEnabled(false); await env.feed.setEnabled(true);
  assert.equal(env.updates.at(-1).features[0].properties.heading, 'route', 'disabling forgets movement history');
});
test('feed accepts a movement bearing and rejects malformed directions', () => {
  const withBearing = bearing => {const data = snapshot(); Object.assign(data.features[0].properties, bearing); return data;};
  assert.equal(validTransportFeed(withBearing({bearing: 359.9, heading: 'movement'}), now).features.length, 1);
  for (const bad of [{bearing: 360, heading: 'movement'}, {bearing: -1, heading: 'movement'}, {bearing: 90}, {heading: 'movement'}, {bearing: 90, heading: 'route'}, {bearing: '90', heading: 'movement'}]) {
    assert.throws(() => validTransportFeed(withBearing(bad), now), /Invalid bus direction/, JSON.stringify(bad));
  }
});
