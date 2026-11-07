import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metresPerPixel,
  DISCOVER_ZOOM,
  DEFAULT_CENTER,
  classifyFix,
  accuracyCircle,
  distanceKilometres,
  formatAge
} from '../src/core.js';
import {PositionTracker, positionFeatures} from '../src/position.js';

const bounds = [[17.8, 41.3], [21, 44.1]];

test('default camera opens at about one ground metre per CSS pixel', () => {
  const metres = metresPerPixel(DEFAULT_CENTER[1], DISCOVER_ZOOM);
  assert.ok(metres > 0.9 && metres < 1.1, `got ${metres}`);
  // The old zoom 14 start was ~3.5 m/px, which hid house numbers (shown below 2 m/px).
  assert.ok(metresPerPixel(DEFAULT_CENTER[1], 14) > 3);
});

test('fix classification separates live, approximate, stale and outside', () => {
  const now = 1_000_000;
  const podgorica = [19.26, 42.44];
  const classify = fix => classifyFix(fix, now, bounds);
  assert.equal(classify({coordinates: podgorica, accuracy: 12, timestamp: now - 1000}), 'live');
  assert.equal(classify({coordinates: podgorica, accuracy: 51, timestamp: now - 1000}), 'approximate');
  assert.equal(classify({coordinates: podgorica, accuracy: 5, timestamp: now - 31000}), 'stale');
  assert.equal(classify({coordinates: [13.4, 52.5], accuracy: 5, timestamp: now}), 'outside');
});

test('accuracy ring is ground-scaled', () => {
  const ring = accuracyCircle([19.26, 42.44], 100).coordinates[0];
  for (const point of ring) {
    const radiusMetres = distanceKilometres([19.26, 42.44], point) * 1000;
    assert.ok(Math.abs(radiusMetres - 100) < 2, `got ${radiusMetres}`);
  }
  assert.deepEqual(ring[0], ring.at(-1));
});

test('formatAge reads seconds then minutes', () => {
  assert.equal(formatAge(12_400), '12 s');
  assert.equal(formatAge(150_000), '3 min');
});

// Records watch requests and keeps the latest callbacks, so a test can report a fix or an error itself.
function fakeGeolocation() {
  const geolocation = {
    watches: 0,
    cleared: 0,
    watchPosition(onPosition, onError, options) {
      Object.assign(geolocation, {onPosition, onError, options});
      geolocation.watches++;
      return geolocation.watches;
    },
    clearWatch() {
      geolocation.cleared++;
    }
  };
  return geolocation;
}
const permission = state => ({query: async () => ({state, addEventListener() {}})});
const permissionDeniedCode = 1;
const timeoutCode = 3;

// A secure page with a fake browser location; options override any of them.
function tracker(geolocation, options) {
  return new PositionTracker({bounds, geolocation, secure: true, every: () => {}, ...options});
}

test('granted permission starts locating without a click and reports a fix', async () => {
  const geolocation = fakeGeolocation();
  const states = [];
  let now = 5000;
  const granted = tracker(geolocation, {
    permissions: permission('granted'),
    now: () => now,
    onChange: snapshot => states.push(snapshot.state)
  });
  await granted.start();
  assert.equal(geolocation.watches, 1);
  assert.equal(geolocation.options.timeout, 15000);
  assert.equal(states.at(-1), 'acquiring');
  geolocation.onPosition({coords: {longitude: 19.26, latitude: 42.44, accuracy: 8}, timestamp: now});
  assert.equal(granted.state, 'live');
  assert.equal(positionFeatures(granted.snapshot()).features.length, 2);
  now += 40000;
  granted.evaluate();
  assert.equal(granted.state, 'stale');
});

test('denied, timeout and insecure states never fabricate a marker or loop', async () => {
  const geolocation = fakeGeolocation();
  const denied = tracker(geolocation, {permissions: permission('denied')});
  await denied.start();
  assert.equal(denied.state, 'denied');
  assert.equal(geolocation.watches, 0);
  assert.equal(positionFeatures(denied.snapshot()).features.length, 0);

  const timing = tracker(geolocation, {permissions: permission('prompt')});
  await timing.start();
  assert.equal(timing.state, 'prompt');
  geolocation.onError({code: timeoutCode});
  assert.equal(timing.state, 'timeout');
  // The person blocks location in the prompt: the browser records denied, then reports code 1.
  timing.permission = 'denied';
  geolocation.onError({code: permissionDeniedCode});
  assert.equal(timing.state, 'denied');
  assert.ok(geolocation.cleared > 0);
  assert.equal(positionFeatures(timing.snapshot()).features.length, 0);

  // A dismissed prompt is not a browser block: it stays retryable.
  const dismissed = tracker(geolocation, {permissions: permission('prompt')});
  await dismissed.start();
  geolocation.onError({code: permissionDeniedCode});
  assert.equal(dismissed.state, 'prompt');

  const insecure = tracker(geolocation, {secure: false});
  await insecure.start();
  assert.equal(insecure.state, 'insecure');
});

test('a fix outside coverage is reported, not drawn', async () => {
  const geolocation = fakeGeolocation();
  const abroad = tracker(geolocation, {permissions: permission('granted'), now: () => 1});
  await abroad.start();
  geolocation.onPosition({coords: {longitude: 13.4, latitude: 52.5, accuracy: 5}, timestamp: 1});
  assert.equal(abroad.state, 'outside');
  assert.equal(positionFeatures(abroad.snapshot()).features.length, 0);
});

test('retrying positioning never makes the previous fix appear current', () => {
  const fix = {coordinates: [19.26, 42.44], accuracy: 18, timestamp: 1};
  const features = positionFeatures({state: 'acquiring', fix}).features;
  assert.deepEqual(features.map(feature => feature.properties.state), ['stale', 'stale']);
  assert.deepEqual(features[1].geometry.coordinates, fix.coordinates);
});
