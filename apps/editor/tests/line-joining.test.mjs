import test from 'node:test';
import assert from 'node:assert/strict';
import {joiningPoint} from '../src/line-joining.js';

const at = (east, north) => [19.25 + east * 0.0001, 42.44 + north * 0.0001];
const position = (x, y) => ({
  x,
  y,
  dist(other) {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
});
const map = {
  project: ([longitude, latitude]) => position(longitude * 1e6, latitude * 1e6)
};
const candidate = {coordinate: at(2, 0), distanceMetres: 1, points: []};

test('a point joins a line close by, and stays where it was put with the magnet off', () => {
  const near = at(2, 0.02);
  assert.deepEqual(joiningPoint(near, [candidate], {map}), candidate.coordinate);
  assert.equal(joiningPoint(near, [candidate], {map, isMagnetOn: () => false}), null);
});
