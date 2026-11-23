import test from 'node:test';
import assert from 'node:assert/strict';
import {longAxisLine} from '../tools/green-area-labels.mjs';

const metresPerDegreeLatitude = 111320;
const originLatitude = 42.44;
const metresPerDegreeLongitude = metresPerDegreeLatitude * Math.cos((originLatitude * Math.PI) / 180);
const toDegrees = ([east, north]) => [19.26 + east / metresPerDegreeLongitude, originLatitude + north / metresPerDegreeLatitude];
const toMetres = ([longitude, latitude]) => [
  (longitude - 19.26) * metresPerDegreeLongitude,
  (latitude - originLatitude) * metresPerDegreeLatitude
];

// A 200 m × 40 m area turned 30° from east: the label line lies along its long side, centred, and reads west to east.
test('a label line follows the long side of a turned area', () => {
  const angle = Math.PI / 6;
  const along = [Math.cos(angle), Math.sin(angle)];
  const across = [-along[1], along[0]];
  const corner = (alongMetres, acrossMetres) =>
    toDegrees([along[0] * alongMetres + across[0] * acrossMetres, along[1] * alongMetres + across[1] * acrossMetres]);
  const ring = [corner(-100, -20), corner(100, -20), corner(100, 20), corner(-100, 20), corner(-100, -20)].reverse();
  const [start, end] = longAxisLine(ring).map(toMetres);
  const lineAngle = Math.atan2(end[1] - start[1], end[0] - start[0]);
  const lineLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const centre = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const toleranceMetres = 0.5;
  assert.ok(Math.abs(lineAngle - angle) < 0.001, `angle ${lineAngle}`);
  assert.ok(Math.abs(lineLength - 160) < toleranceMetres, `length ${lineLength}`);
  assert.ok(Math.hypot(...centre) < toleranceMetres, `centre ${centre}`);
});
