import test from 'node:test';
import assert from 'node:assert/strict';
import {metersPerPixel,DISCOVER_ZOOM,DEFAULT_CENTER,PLACE_SCALE_FILTER,classifyFix,accuracyCircle,distance,formatAge} from '../src/core.js';
import {PositionTracker,positionFeatures} from '../src/position.js';

const bounds = [[17.8, 41.3], [21, 44.1]];

test('default camera opens at about one ground metre per CSS pixel', () => {
  const mpp = metersPerPixel(DEFAULT_CENTER[1], DISCOVER_ZOOM);
  assert.ok(mpp > 0.9 && mpp < 1.1, `got ${mpp}`);
  // The old zoom 14 start was ~3.5 m/px, which hid house numbers (shown below 2 m/px).
  assert.ok(metersPerPixel(DEFAULT_CENTER[1], 14) > 3);
});

// Evaluates the shipped filter's step/match shape directly, so the test cannot drift from what the map uses.
function evaluate(expression, zoom, category) {
  if (!Array.isArray(expression)) return expression;
  const [op, ...args] = expression;
  if (op === 'step') {
    let output = args[1];
    for (let i = 2; i < args.length; i += 2) if (zoom >= args[i]) output = args[i + 1];
    return evaluate(output, zoom, category);
  }
  if (op === 'match') { assert.deepEqual(args[0], ['get', 'category']); return args[1].includes(category) ? args[2] : args[3]; }
  throw new Error('Unexpected filter operator ' + op);
}

test('ordinary businesses never appear at country or region scale', () => {
  assert.deepEqual(PLACE_SCALE_FILTER.slice(0, 2), ['step', ['zoom']]);
  for (const category of ['food', 'shops', 'stay', 'sights', 'essentials']) {
    for (const zoom of [7, 8, 10, 12]) assert.equal(evaluate(PLACE_SCALE_FILTER, zoom, category), false, `${category}@${zoom}`);
    assert.equal(evaluate(PLACE_SCALE_FILTER, 14, category), true);
  }
  assert.equal(evaluate(PLACE_SCALE_FILTER, 13, 'sights'), true);
  assert.equal(evaluate(PLACE_SCALE_FILTER, 13, 'essentials'), true);
  assert.equal(evaluate(PLACE_SCALE_FILTER, 13, 'food'), false);
});

test('fix classification separates live, approximate, stale and outside', () => {
  const now = 1_000_000;
  assert.equal(classifyFix({coordinates: [19.26, 42.44], accuracy: 12, timestamp: now - 1000}, now, bounds), 'live');
  assert.equal(classifyFix({coordinates: [19.26, 42.44], accuracy: 51, timestamp: now - 1000}, now, bounds), 'approximate');
  assert.equal(classifyFix({coordinates: [19.26, 42.44], accuracy: 5, timestamp: now - 31000}, now, bounds), 'stale');
  assert.equal(classifyFix({coordinates: [13.4, 52.5], accuracy: 5, timestamp: now}, now, bounds), 'outside');
});

test('accuracy ring is ground-scaled', () => {
  const ring = accuracyCircle([19.26, 42.44], 100).coordinates[0];
  for (const point of ring) assert.ok(Math.abs(distance([19.26, 42.44], point) * 1000 - 100) < 2);
  assert.deepEqual(ring[0], ring.at(-1));
});

test('formatAge reads seconds then minutes', () => {
  assert.equal(formatAge(12_400), '12 s');
  assert.equal(formatAge(150_000), '3 min');
});

function fakeGeo() {
  const geo = {watches: 0, cleared: 0, watchPosition(ok, err, options) { geo.ok = ok; geo.err = err; geo.options = options; return ++geo.watches; }, clearWatch() { geo.cleared++; }};
  return geo;
}
const permission = state => ({query: async () => ({state, addEventListener() {}})});

test('granted permission starts locating without a click and reports a fix', async () => {
  const geo = fakeGeo(), states = [];
  let now = 5000;
  const tracker = new PositionTracker({bounds, geolocation: geo, permissions: permission('granted'), secure: true, now: () => now, every: () => {}, onChange: s => states.push(s.state)});
  await tracker.start();
  assert.equal(geo.watches, 1);
  assert.equal(geo.options.timeout, 15000);
  assert.equal(states.at(-1), 'acquiring');
  geo.ok({coords: {longitude: 19.26, latitude: 42.44, accuracy: 8}, timestamp: now});
  assert.equal(tracker.state, 'live');
  assert.equal(positionFeatures(tracker.snapshot()).features.length, 2);
  now += 40000; tracker.evaluate();
  assert.equal(tracker.state, 'stale');
});

test('denied, timeout and insecure states never fabricate a marker or loop', async () => {
  const geo = fakeGeo();
  const denied = new PositionTracker({bounds, geolocation: geo, permissions: permission('denied'), secure: true, every: () => {}});
  await denied.start();
  assert.equal(denied.state, 'denied'); assert.equal(geo.watches, 0);
  assert.equal(positionFeatures(denied.snapshot()).features.length, 0);

  const timing = new PositionTracker({bounds, geolocation: geo, permissions: permission('prompt'), secure: true, every: () => {}});
  await timing.start();
  assert.equal(timing.state, 'prompt');
  geo.err({code: 3});
  assert.equal(timing.state, 'timeout');
  // The person blocks location in the prompt: the browser records denied, then reports code 1.
  timing.permission = 'denied';
  geo.err({code: 1});
  assert.equal(timing.state, 'denied'); assert.ok(geo.cleared > 0);
  assert.equal(positionFeatures(timing.snapshot()).features.length, 0);

  // A dismissed prompt is not a browser block: it stays retryable.
  const dismissed = new PositionTracker({bounds, geolocation: geo, permissions: permission('prompt'), secure: true, every: () => {}});
  await dismissed.start();
  geo.err({code: 1});
  assert.equal(dismissed.state, 'prompt');

  const insecure = new PositionTracker({bounds, geolocation: geo, secure: false, every: () => {}});
  await insecure.start();
  assert.equal(insecure.state, 'insecure');
});

test('a fix outside coverage is reported, not drawn', async () => {
  const geo = fakeGeo();
  const tracker = new PositionTracker({bounds, geolocation: geo, permissions: permission('granted'), secure: true, now: () => 1, every: () => {}});
  await tracker.start();
  geo.ok({coords: {longitude: 13.4, latitude: 52.5, accuracy: 5}, timestamp: 1});
  assert.equal(tracker.state, 'outside');
  assert.equal(positionFeatures(tracker.snapshot()).features.length, 0);
});

test('retrying positioning never makes the previous fix appear current', () => {
  const fix = {coordinates: [19.26, 42.44], accuracy: 18, timestamp: 1};
  const features = positionFeatures({state: 'acquiring', fix}).features;
  assert.deepEqual(features.map(feature => feature.properties.state), ['stale', 'stale']);
  assert.deepEqual(features[1].geometry.coordinates, fix.coordinates);
});
