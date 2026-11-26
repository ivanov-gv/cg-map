import test from 'node:test';
import assert from 'node:assert/strict';
import {withoutJoin} from '../src/geometry/line-joining.js';
import {waterBehaviors} from '../src/layers/water/layer-water.js';
import {flowsInto, joinedWaterPoints, linesTouched, riverEndingOnShores, waterJointsIn} from '../src/layers/water/water-joins.js';

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

const coast = line('coast', [[0, -2], [8, -2]], 'coastline');
const seaRing = [at(0, -2.3), at(8, -2.3), at(8, -9), at(0, -9), at(0, -2.3)];
const sea = entry('sea', 'ocean', {type: 'MultiPolygon', coordinates: [[seaRing]]});

test('a mouth on the coast, in the sea or inside a water area is joined', () => {
  assert.deepEqual(statusesOf(line('brook', [[3, 3], [3, -2]]), coast, sea), ['deadEnd', 'joined']);
  assert.deepEqual(statusesOf(line('brook', [[3, 3], [3, -5]]), sea), ['deadEnd', 'joined']);
  const through = line('through', [[3, 1], [5, 1]], 'river');
  assert.deepEqual(statusesOf(through, lake), ['deadEnd', 'joined']);
  assert.equal(flowsInto(through, [through, lake]).key, 'lake');
  const brook = line('brook', [[5, 3], [5, 1]]);
  const river = line('river', [[4.5, 1], [5, 1], [5, 3]]);
  assert.equal(flowsInto(brook, [lake, river]).key, 'river', 'the line it shares a point with comes before the area around it');
});

test('a river keeps its mouth on the coast when either of them is dragged', () => {
  const brook = line('brook', [[3, 3], [3, -2]]);
  const dragged = {...brook.feature.geometry, coordinates: [at(3, 3), at(4, -1.5)]};
  assert.deepEqual(riverEndingOnShores(brook.feature.geometry, dragged, [coast]).coordinates[1], at(4, -2));
  const context = {entriesOf: filename => (filename === 'water.geojson' ? [brook, coast] : [])};
  const movedCoast = {...coast.feature, geometry: {...coast.feature.geometry, coordinates: [at(0, -3), at(8, -3)]}};
  const edits = waterBehaviors['water.geojson'].companionEdits(
    {key: 'coast', feature: movedCoast, before: coast.feature, origins: [0, 1]},
    context
  );
  assert.deepEqual(edits.find(({key}) => key === 'brook').after.geometry.coordinates[1], at(3, -3));
});

test('only a disconnected end leaves its shore', () => {
  const pond = entry('pond', 'pond', {type: 'Polygon', coordinates: [[at(-2, 0), at(0, 0), at(0, 2), at(-2, 2), at(-2, 0)]]});
  const channel = line('channel', [[0, 1], [4, 1]]);
  const dragged = {...channel.feature.geometry, coordinates: [at(0.5, 0.5), at(3.5, 1.5)]};
  const facts = {origins: [0, 1], freePoints: new Set(['19.250000 42.440100'])};
  const kept = riverEndingOnShores(channel.feature.geometry, dragged, [pond, lake], facts);
  assert.deepEqual(kept.coordinates, [at(0.5, 0.5), at(4, 1.5)]);
});

test('a line that moves along and is touched gets both', () => {
  const brook = line('brook', [[2, 3], [2, 0]]);
  // The joint goes east, and the new point of the river lies on the brook as it is then.
  const coordinates = [at(0, 0), at(2.2, 1.5), at(2.4, 0), at(4, 1)];
  const change = {key: 'river', feature: {...river.feature, geometry: {type: 'LineString', coordinates}}, before: river.feature};
  const edits = waterBehaviors['water.geojson'].companionEdits({...change, origins: [0, null, 1, 2]}, {entriesOf: () => [river, brook]});
  assert.equal(edits.length, 1);
  assert.deepEqual(edits[0].after.geometry.coordinates, [at(2, 3), at(2.2, 1.5), at(2.4, 0)]);
});

test('a point taken out of a river leaves no water behind, and a disconnected one moves nobody', () => {
  const brook = line('brook', [[2, 3], [2, 0]]);
  const geometry = {type: 'LineString', coordinates: [at(0, 0), at(4, 1)]};
  const change = {key: 'river', feature: {...river.feature, geometry}, before: river.feature, origins: [0, 2]};
  const context = {entriesOf: () => [river, brook]};
  const [edit] = waterBehaviors['water.geojson'].companionEdits(change, context);
  assert.deepEqual(edit.after.geometry.coordinates.at(-1), at(0, 0));
  const freed = {...change, extras: {freePoints: ['19.250200 42.440000']}};
  assert.deepEqual(waterBehaviors['water.geojson'].companionEdits(freed, context), []);
});
