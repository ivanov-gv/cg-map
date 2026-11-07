import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metresPerPixel,
  DISCOVER_ZOOM,
  DEFAULT_CENTER,
  classifyFix,
  accuracyCircle,
  distanceKilometres,
  formatPositionAge
} from '../src/core.js';
import {PositionTracker, positionFeatures} from '../src/position.js';

const bounds = [
  [17.8, 41.3],
  [21, 44.1]
];

test('default camera opens at about one ground metre per CSS pixel', () => {
  const scaleMetresPerPixel = metresPerPixel(DEFAULT_CENTER[1], DISCOVER_ZOOM);
  assert.ok(scaleMetresPerPixel > 0.9 && scaleMetresPerPixel < 1.1, `got ${scaleMetresPerPixel}`);
  // The old zoom 14 start was ~3.5 m/px, which hid house numbers (shown below 2 m/px).
  assert.ok(metresPerPixel(DEFAULT_CENTER[1], 14) > 3);
});

test('fix classification separates live, approximate, stale and outside', () => {
  const now = 1_000_000;
  assert.equal(
    classifyFix({coordinates: [19.26, 42.44], accuracy: 12, timestamp: now - 1000}, now, bounds),
    'live'
  );
  assert.equal(
    classifyFix({coordinates: [19.26, 42.44], accuracy: 51, timestamp: now - 1000}, now, bounds),
    'approximate'
  );
  assert.equal(
    classifyFix({coordinates: [19.26, 42.44], accuracy: 5, timestamp: now - 31000}, now, bounds),
    'stale'
  );
  assert.equal(classifyFix({coordinates: [13.4, 52.5], accuracy: 5, timestamp: now}, now, bounds), 'outside');
});

test('accuracy ring is ground-scaled', () => {
  const ring = accuracyCircle([19.26, 42.44], 100).coordinates[0];
  for (const point of ring) assert.ok(Math.abs(distanceKilometres([19.26, 42.44], point) * 1000 - 100) < 2);
  assert.deepEqual(ring[0], ring.at(-1));
});

test('formatAge reads seconds then minutes', () => {
  assert.equal(formatPositionAge(12_400), '12 s');
  assert.equal(formatPositionAge(150_000), '3 min');
});

function fakeGeo() {
  const geolocation = {
    watches: 0,
    cleared: 0,
    watchPosition(onPosition, onError, options) {
      geolocation.ok = onPosition;
      geolocation.err = onError;
      geolocation.options = options;
      return ++geolocation.watches;
    },
    clearWatch() {
      geolocation.cleared++;
    }
  };
  return geolocation;
}
const permission = state => ({query: async () => ({state, addEventListener() {}})});

test('granted permission starts locating without a click and reports a fix', async () => {
  const geolocation = fakeGeo();
  const states = [];
  let now = 5000;
  const tracker = new PositionTracker({
    bounds,
    geolocation: geolocation,
    permissions: permission('granted'),
    secure: true,
    now: () => now,
    every: () => {},
    onChange: snapshot => states.push(snapshot.state)
  });
  await tracker.start();
  assert.equal(geolocation.watches, 1);
  assert.equal(geolocation.options.timeout, 15000);
  assert.equal(states.at(-1), 'acquiring');
  geolocation.ok({coords: {longitude: 19.26, latitude: 42.44, accuracy: 8}, timestamp: now});
  assert.equal(tracker.state, 'live');
  assert.equal(positionFeatures(tracker.snapshot()).features.length, 2);
  now += 40000;
  tracker.evaluate();
  assert.equal(tracker.state, 'stale');
});

test('denied, timeout and insecure states never fabricate a marker or loop', async () => {
  const geolocation = fakeGeo();
  const denied = new PositionTracker({
    bounds,
    geolocation: geolocation,
    permissions: permission('denied'),
    secure: true,
    every: () => {}
  });
  await denied.start();
  assert.equal(denied.state, 'denied');
  assert.equal(geolocation.watches, 0);
  assert.equal(positionFeatures(denied.snapshot()).features.length, 0);

  const timing = new PositionTracker({
    bounds,
    geolocation: geolocation,
    permissions: permission('prompt'),
    secure: true,
    every: () => {}
  });
  await timing.start();
  assert.equal(timing.state, 'prompt');
  geolocation.err({code: 3});
  assert.equal(timing.state, 'timeout');
  // The person blocks location in the prompt: the browser records denied, then reports code 1.
  timing.permission = 'denied';
  geolocation.err({code: 1});
  assert.equal(timing.state, 'denied');
  assert.ok(geolocation.cleared > 0);
  assert.equal(positionFeatures(timing.snapshot()).features.length, 0);

  // A dismissed prompt is not a browser block: it stays retryable.
  const dismissed = new PositionTracker({
    bounds,
    geolocation: geolocation,
    permissions: permission('prompt'),
    secure: true,
    every: () => {}
  });
  await dismissed.start();
  geolocation.err({code: 1});
  assert.equal(dismissed.state, 'prompt');

  const insecure = new PositionTracker({bounds, geolocation: geolocation, secure: false, every: () => {}});
  await insecure.start();
  assert.equal(insecure.state, 'insecure');
});

test('a fix outside coverage is reported, not drawn', async () => {
  const geolocation = fakeGeo();
  const tracker = new PositionTracker({
    bounds,
    geolocation: geolocation,
    permissions: permission('granted'),
    secure: true,
    now: () => 1,
    every: () => {}
  });
  await tracker.start();
  geolocation.ok({coords: {longitude: 13.4, latitude: 52.5, accuracy: 5}, timestamp: 1});
  assert.equal(tracker.state, 'outside');
  assert.equal(positionFeatures(tracker.snapshot()).features.length, 0);
});

test('retrying positioning never makes the previous fix appear current', () => {
  const fix = {coordinates: [19.26, 42.44], accuracy: 18, timestamp: 1};
  const features = positionFeatures({state: 'acquiring', fix}).features;
  assert.deepEqual(
    features.map(feature => feature.properties.state),
    ['stale', 'stale']
  );
  assert.deepEqual(features[1].geometry.coordinates, fix.coordinates);
});
