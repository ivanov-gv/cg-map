import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import {
  DirectionTracker,
  compassDirection,
  distanceMetres,
  routeDirection,
  routeLines
} from '../src/vehicle-direction.js';

const vehicleAt = (route, coordinates) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {route}
});
// About 111 m per 0.001° of latitude; 0.001° of longitude is about 82 m at Podgorica.
const origin = [19.26, 42.44];
const north = [19.26, 42.441];
const east = [19.261, 42.44];
// Route 6 runs south to north along longitude 19.26; route 7 runs west to east.
const network = {
  stops: {
    a: {coordinates: [19.26, 42.43]},
    b: {coordinates: [19.26, 42.45]},
    c: {coordinates: [19.25, 42.46]},
    d: {coordinates: [19.27, 42.46]}
  },
  patterns: [
    {route: '6', stops: ['a', 'b']},
    {route: '7', stops: ['c', 'd']}
  ]
};
const near = (actual, expected, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not about ${expected}`);

function trackerWithNetwork() {
  const tracker = new DirectionTracker();
  tracker.setNetwork(network);
  return tracker;
}

test('compass direction is clockwise from north and distances are local', () => {
  near(compassDirection(origin, north), 0);
  near(compassDirection(origin, east), 90);
  near(compassDirection(north, origin), 180);
  near(compassDirection(east, origin), 270);
  near(distanceMetres(origin, north), 111, 1);
});

test('movement rules match the Go server tracker (shared fixture)', () => {
  const {cases} = JSON.parse(
    fileSystem.readFileSync(
      new URL('../../../packages/contracts/fixtures/vehicle-direction-cases.json', import.meta.url)
    )
  );
  for (const {name, checks, want} of cases) {
    const tracker = new DirectionTracker();
    let output = [];
    for (const [fetchedAt, rows] of checks) {
      const vehicles = rows.map(([route, longitude, latitude]) => vehicleAt(route, [longitude, latitude]));
      output = tracker.update(vehicles, fetchedAt);
    }
    assert.equal(output.length, want.length, name);
    output.forEach((vehicle, index) => {
      if (want[index] === null) {
        assert.equal(vehicle.properties.heading, 'unknown', name);
        return;
      }
      assert.equal(vehicle.properties.heading, 'movement', name);
      near(vehicle.properties.bearing, want[index], 0.11);
    });
  }
});

test('without movement, direction is estimated from the nearest segment of the route', () => {
  const tracker = trackerWithNetwork();
  const [first] = tracker.update([vehicleAt('6', [19.2601, 42.44])], 0);
  assert.equal(first.properties.heading, 'route');
  near(first.properties.bearing, 0);
  // Combined route names fall back to their parts.
  near(routeDirection(routeLines(network), '7|99', [19.26, 42.4601]), 90);
  // Movement replaces the estimate as soon as the bus moves.
  const [moved] = tracker.update([vehicleAt('6', [19.2601, 42.439])], 13000);
  assert.equal(moved.properties.heading, 'movement');
  near(moved.properties.bearing, 180);
});

test('implausible jumps, long gaps and far-away buses do not invent movement', () => {
  const tracker = trackerWithNetwork();
  tracker.update([vehicleAt('6', [19.2601, 42.44])], 0);
  // 2 km in 13 s is not the same vehicle.
  assert.equal(tracker.update([vehicleAt('6', [19.2601, 42.458])], 13000)[0].properties.heading, 'route');
  tracker.update([vehicleAt('6', [19.2601, 42.44])], 26000);
  assert.equal(
    tracker.update([vehicleAt('6', [19.2601, 42.441])], 26000 + 61000)[0].properties.heading,
    'route'
  );
  const farAway = tracker.update([vehicleAt('6', [19.5, 42.8]), vehicleAt('unknown', origin)], 100000);
  assert.deepEqual(
    farAway.map(vehicle => vehicle.properties.heading),
    ['unknown', 'unknown']
  );
  assert.ok(farAway.every(vehicle => vehicle.properties.bearing === 0));
});

test('bundled route network gives every current route a direction estimate', () => {
  const snapshot = JSON.parse(
    fileSystem.readFileSync(new URL('../../../data/sources/transit-network.json', import.meta.url))
  );
  const linesByRoute = routeLines(snapshot);
  for (const pattern of snapshot.patterns) {
    const stop = snapshot.stops[pattern.stops[1]].coordinates;
    assert.equal(
      typeof routeDirection(linesByRoute, pattern.route, stop),
      'number',
      `route ${pattern.route}`
    );
  }
  assert.throws(() => routeLines({patterns: 'x'}), /Invalid route network/);
});

test('a movement bearing from the server is used immediately', () => {
  const tracker = trackerWithNetwork();
  const served = {
    ...vehicleAt('6', [19.2601, 42.44]),
    properties: {route: '6', bearing: 180, heading: 'movement'}
  };
  const [first] = tracker.update([served], 0);
  assert.deepEqual([first.properties.heading, first.properties.bearing], ['movement', 180]);
  // Standing still afterwards keeps the server's direction rather than the route estimate.
  const [next] = tracker.update([vehicleAt('6', [19.2601, 42.44])], 13000);
  assert.deepEqual([next.properties.heading, next.properties.bearing], ['movement', 180]);
});
