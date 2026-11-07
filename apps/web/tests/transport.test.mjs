import test from 'node:test';
import assert from 'node:assert/strict';
import {TransportFeed, validTransportFeed} from '../src/transport.js';
const fetchedAtText = '2026-10-18T18:00:00Z';
const checkedAtMilliseconds = Date.parse(fetchedAtText);
const snapshot = () => ({
  type: 'FeatureCollection',
  fetchedAt: fetchedAtText,
  stale: false,
  features: [
    {type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A'}}
  ]
});
const network = {
  stops: {a: {coordinates: [19.26, 42.43]}, b: {coordinates: [19.26, 42.45]}},
  patterns: [{route: '6A', stops: ['a', 'b']}]
};
// Answers the route network request itself, so tests see only vehicle feed requests.
function createEnvironment(feedImpl, clock = () => checkedAtMilliseconds, options = {}) {
  const statuses = [];
  const updates = [];
  const timers = new Map();
  const requests = [];
  let timerId = 0;
  const map = {
    getSource: () => ({setData: feedSnapshot => updates.push(feedSnapshot)}),
    setLayoutProperty: () => {}
  };
  const fetchImpl = (url, requestOptions) => {
    if (url === 'data/transit-network.json') return Promise.resolve(Response.json(network));
    requests.push(url);
    return feedImpl(url, requestOptions);
  };
  const feed = new TransportFeed(map, {
    ...options,
    fetchImpl,
    now: clock,
    onStatus: state => statuses.push(state),
    schedule: callback => {
      timers.set(++timerId, callback);
      return timerId;
    },
    cancel: key => timers.delete(key)
  });
  return {feed, statuses, updates, timers, requests};
}
test('transport feed rejects expired timestamps and invalid GPS', () => {
  assert.equal(validTransportFeed(snapshot(), checkedAtMilliseconds).features.length, 1);
  assert.throws(() => validTransportFeed(snapshot(), checkedAtMilliseconds + 61000));
  const bad = snapshot();
  bad.features[0].geometry.coordinates[0] = 0;
  assert.throws(() => validTransportFeed(bad, checkedAtMilliseconds));
});
test('late responses cannot restore disabled transport or restart polling', async () => {
  let resolve;
  const environment = createEnvironment(
    () =>
      new Promise(done => {
        resolve = done;
      })
  );
  const pending = environment.feed.setEnabled(true);
  environment.feed.setEnabled(false);
  resolve(Response.json(snapshot()));
  await pending;
  assert.equal(environment.statuses.at(-1).state, 'off');
  assert.equal(environment.updates.at(-1).features.length, 0);
  assert.equal(environment.timers.size, 0);
});
test('failed refresh shows stale positions briefly, then removes expired buses', async () => {
  let shouldFail = false;
  let nowMilliseconds = checkedAtMilliseconds;
  const environment = createEnvironment(
    async () => {
      if (shouldFail) throw Error('network');
      return Response.json(snapshot());
    },
    () => nowMilliseconds
  );
  await environment.feed.setEnabled(true);
  assert.equal(environment.statuses.at(-1).state, 'live');
  shouldFail = true;
  nowMilliseconds += 14000;
  await environment.feed.refresh();
  assert.equal(environment.statuses.at(-1).state, 'stale');
  nowMilliseconds += 60000;
  await environment.feed.refresh();
  assert.equal(environment.statuses.at(-1).state, 'unavailable');
  assert.equal(environment.updates.at(-1).features.length, 0);
  environment.feed.pause();
  assert.equal(environment.timers.size, 0);
  assert.equal(environment.statuses.at(-1).state, 'offline');
});
test('feed reads the configured URL and gives every bus a direction', async () => {
  let nowMilliseconds = checkedAtMilliseconds;
  let step = 0;
  const environment = createEnvironment(
    async () => {
      const feedSnapshot = snapshot();
      feedSnapshot.fetchedAt = new Date(nowMilliseconds).toISOString();
      feedSnapshot.features[0].geometry.coordinates = [19.26 + step * 0.002, 42.44];
      return Response.json(feedSnapshot);
    },
    () => nowMilliseconds,
    {url: 'https://maps.example.com/api/v1/transport/vehicles'}
  );
  await environment.feed.setEnabled(true);
  assert.deepEqual(environment.requests, ['https://maps.example.com/api/v1/transport/vehicles']);
  let vehicle = environment.updates.at(-1).features[0].properties;
  assert.equal(vehicle.heading, 'route');
  assert.ok(Math.abs(vehicle.bearing) < 1, 'estimated along route 6A (north)');
  step = 1;
  nowMilliseconds += 13000;
  await environment.feed.refresh();
  vehicle = environment.updates.at(-1).features[0].properties;
  assert.equal(vehicle.heading, 'movement');
  assert.ok(Math.abs(vehicle.bearing - 90) < 1, 'moved east');
  environment.feed.setEnabled(false);
  await environment.feed.setEnabled(true);
  assert.equal(
    environment.updates.at(-1).features[0].properties.heading,
    'route',
    'disabling forgets movement history'
  );
});
test('feed accepts a movement bearing and rejects malformed directions', () => {
  const withBearing = bearing => {
    const feedSnapshot = snapshot();
    Object.assign(feedSnapshot.features[0].properties, bearing);
    return feedSnapshot;
  };
  assert.equal(
    validTransportFeed(withBearing({bearing: 359.9, heading: 'movement'}), checkedAtMilliseconds).features
      .length,
    1
  );
  for (const bad of [
    {bearing: 360, heading: 'movement'},
    {bearing: -1, heading: 'movement'},
    {bearing: 90},
    {heading: 'movement'},
    {bearing: 90, heading: 'route'},
    {bearing: '90', heading: 'movement'}
  ]) {
    assert.throws(
      () => validTransportFeed(withBearing(bad), checkedAtMilliseconds),
      /Invalid bus direction/,
      JSON.stringify(bad)
    );
  }
});
