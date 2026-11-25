import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutJoin} from '../src/line-joining.js';
import {waterBehaviors} from '../src/layer-water.js';
import {joinedWaterPoints, linesTouched, waterJointsIn} from '../src/water-joins.js';

const origin = [19.25, 42.44];
// About eight metres east and eleven north.
const step = 0.0001;
const at = (east, north) => [origin[0] + east * step, origin[1] + north * step].map(value => Math.round(value * 1e7) / 1e7);
const entry = (key, kind, geometry, properties = {}) => ({
  filename: 'water.geojson',
  key,
  feature: {type: 'Feature', properties: {kind, ...properties}, geometry}
});
const line = (key, points, kind = 'stream', properties = {}) =>
  entry(key, kind, {type: 'LineString', coordinates: points.map(([east, north]) => at(east, north))}, properties);
const lake = entry('lake', 'lake', {type: 'Polygon', coordinates: [[at(4, 0), at(6, 0), at(6, 2), at(4, 2), at(4, 0)]]});
const everything = [19.2, 42.4, 19.3, 42.5];
const river = line('river', [[0, 0], [2, 0], [4, 1]], 'river');
const statusesOf = (...entries) => waterJointsIn(everything, entries).map(({status}) => status).sort();

test('a waterway joins another that has its point and the shore it ends on, and a spring is loose', () => {
  assert.deepEqual(statusesOf(river, lake), ['deadEnd', 'joined']);
  assert.deepEqual(statusesOf(river, lake, line('brook', [[2, 3], [2, 0]])), ['deadEnd', 'deadEnd', 'joined', 'joined']);
});

test('an end beside other water and a crossing without a join are found, and a culvert under a canal is not', () => {
  assert.ok(statusesOf(river, line('brook', [[1, 3], [1, 0.2]])).includes('near'));
  assert.ok(statusesOf(river, line('brook', [[1, 3], [1, -3]])).includes('crossing'));
  assert.ok(!statusesOf(river, line('brook', [[1, 3], [1, -3]], 'stream', {tunnel: 'culvert'})).includes('crossing'));
  const coast = line('coast', [[1, 3], [1, -3]], 'coastline');
  assert.deepEqual(statusesOf(coast), [], 'the edge of the sea is no waterway');
});

test('the joined points of a waterway are those of other lines and the ends on a shore', () => {
  const brook = line('brook', [[2, 3], [2, 0]]);
  assert.deepEqual(joinedWaterPoints(river, [river, brook, lake]), [at(2, 0), at(4, 1)]);
});

test('a drawn brook gives the river it is put on a point there', () => {
  const drawn = line('local:1', [[1, 3], [1, 0]]);
  const [joined] = waterBehaviors['water.geojson'].companionEdits(
    {key: 'local:1', feature: drawn.feature, before: null, extras: {}},
    {entriesOf: () => [river]}
  );
  assert.deepEqual(joined.after.geometry.coordinates[1], at(1, 0));
  assert.deepEqual(linesTouched('local:1', null, line('x', [[1, 3], [1, 2]]).feature.geometry, [river]), []);
});

test('a disconnected end is pulled back and takes nothing along', () => {
  const brook = line('brook', [[2, 3], [2, 0]]);
  const geometry = withoutJoin(brook.feature.geometry, 1);
  assert.ok(geometry.coordinates[1][1] > at(2, 0)[1]);
  const change = {key: 'brook', feature: {...brook.feature, geometry}, before: brook.feature};
  const context = {entriesOf: () => [river, brook]};
  const {companionEdits} = waterBehaviors['water.geojson'];
  assert.equal(companionEdits({...change, extras: {}}, context).length, 1);
  assert.deepEqual(companionEdits({...change, extras: {freePoints: ['19.250200 42.440000']}}, context), []);
});
