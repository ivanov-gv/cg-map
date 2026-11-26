import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBehaviors, turnIndex} from '../src/layers/routes/layer-routes.js';
import {roadsidePosition, stopBehaviors} from '../src/layers/stops/layer-stops.js';
import {RoadNetwork} from '../src/layers/roads/road-paths.js';
import {lineEdits, movedStop, reversedStops, routeWithoutStop} from '../src/layers/routes/route-stops.js';

const step = 0.001;
const at = (east, north) => [Math.round((19.26 + east * step) * 1e6) / 1e6, Math.round((42.44 + north * step) * 1e6) / 1e6];
const road = (coordinates, properties = {}) => ({
  type: 'Feature',
  properties: {kind: 'residential', name: 'Main street', ...properties},
  geometry: {type: 'LineString', coordinates}
});
const stop = (stopId, lines, position = [0, 0]) => ({
  type: 'Feature',
  id: stopId,
  properties: {stopId, name: `Stop ${stopId}`, ...(lines ? {lines} : {})},
  geometry: {type: 'Point', coordinates: at(...position)}
});
const route = (number, ...directions) => ({
  type: 'Feature',
  properties: {number, network: 'bus', directions: directions.map(stops => ({headsign: '', stops}))},
  geometry: null
});

function contextWith(featuresByFile) {
  return {
    isPhone: () => false,
    entriesOf: filename =>
      (featuresByFile[filename] ?? []).map((feature, index) => ({filename, key: String(index), feature})),
    session: {changes: () => [], workingFeature: () => null}
  };
}

test('a stop is put on the side of the road someone clicks, seen along the road', () => {
  const context = contextWith({'roads.geojson': [road([at(0, 0), at(5, 0)]), road([at(0, 0.1), at(5, 0.1)], {kind: 'footway'})]});
  const north = roadsidePosition(at(2, 0.09), context);
  const south = roadsidePosition(at(2, -0.09), context);
  assert.deepEqual([north.side, south.side], ['left', 'right']);
  assert.ok(north.coordinate[1] > 42.44 && south.coordinate[1] < 42.44);
  assert.equal(roadsidePosition(at(2, 5), context), null, 'no road is near');
  const prepared = stopBehaviors['transport-stops.geojson'].prepared(stop('1', null, [2, -0.05]), context, {isNew: true, key: 'local:1'});
  assert.equal(prepared.properties.side, 'right');
  const {problem} = stopBehaviors['transport-stops.geojson'];
  assert.equal(problem({feature: stop('1', null, [2, 0.05]), before: null}, context), null);
  assert.match(problem({feature: stop('1', null, [2, 5]), before: null}, context), /on a road/);
  const untouched = stop('1', null, [2, 5]);
  assert.equal(problem({feature: untouched, before: untouched}, context), null, 'a source stop stands as it is');
});

test('a removed stop leaves its lines, and a line that needs it keeps it', () => {
  const longLine = route('6', ['1', '2', '3'], ['3', '2', '1']);
  const context = contextWith({'transit-routes.json': [longLine]});
  const {deletion} = stopBehaviors['transport-stops.geojson'];
  const {edits} = deletion({feature: stop('2', ['6'])}, context);
  assert.deepEqual(edits[0].after.properties.directions.map(({stops}) => stops), [['1', '3'], ['3', '1']]);
  const shortContext = contextWith({'transit-routes.json': [route('7', ['1', {turn: at(1, 1)}, '2'])]});
  assert.match(deletion({feature: stop('2', ['7'])}, shortContext).problem, /Line 7/);
  assert.equal(routeWithoutStop(route('8', ['1', '2']), '1'), null);
});

test('stops are moved in their order, and the other direction starts as the reverse without turns', () => {
  assert.deepEqual(movedStop(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(reversedStops(['a', {turn: [1, 2]}, 'b']), ['b', 'a']);
});

test('the lines of a stop follow the routes, and only stops of the changed route are touched', () => {
  const stops = [stop('1', ['6']), stop('2', ['6']), stop('3'), stop('9', ['unreviewed'])].map((feature, index) => ({
    filename: 'transport-stops.geojson',
    key: String(index),
    feature
  }));
  const before = route('6', ['1', '2']);
  const after = route('6', ['1', '3']);
  const edits = lineEdits(stops, [after, route('10', ['3', '1'])], [before, after]);
  assert.deepEqual(
    edits.map(({key, after: changed}) => [key, changed.properties.lines]),
    [
      ['0', ['10', '6']],
      ['1', undefined],
      ['2', ['10', '6']]
    ]
  );
});

test('a line needs a name and stops, says where it goes, and its number is its own in its network', () => {
  const {prepared, problem} = routeBehaviors['transit-routes.json'];
  const context = contextWith({
    'transport-stops.geojson': [stop('1'), stop('2')],
    'transit-routes.json': [route('6', ['1', '2'])]
  });
  const named = prepared(route('7', ['1', '2', {turn: at(1, 1)}]), context);
  assert.equal(named.properties.directions[0].headsign, 'Stop 2');
  assert.match(problem({key: 'local:1', feature: route('6', ['2', '1'])}, context), /already exists/);
  assert.equal(problem({key: 'local:1', feature: named}, context), null);
  assert.match(problem({key: 'local:1', feature: route(undefined, ['1', '2'])}, context), /number or a name/);
  const intercity = prepared({...named, properties: {...named.properties, network: 'intercity'}}, context);
  assert.match(intercity.properties.directions[0].entityId, /^local:/);
});

test('the way follows the streets, against no one-way street, and is straight where none is known', () => {
  const network = new RoadNetwork([
    road([at(0, 0), at(0, 2), at(2, 2)]),
    road([at(0, 0), at(2, 0), at(2, 2)], {oneway: '-1'}),
    road([at(0, 0), at(2, 2)], {kind: 'footway'})
  ]);
  assert.deepEqual(network.pathBetween(at(0, 0), at(2, 2)), [at(0, 0), at(0, 0), at(0, 2), at(2, 2), at(2, 2)]);
  const back = network.pathBetween(at(2, 2), at(0, 0)).map(String);
  assert.ok(back.includes(String(at(2, 0))) || back.includes(String(at(0, 2))));
  assert.deepEqual(network.pathBetween(at(0, 0), at(50, 50)), [at(0, 0), at(50, 50)]);
});

test('a turn point goes between the stops whose way it bends least', () => {
  const positions = [at(0, 0), at(4, 0), at(4, 4)];
  assert.equal(turnIndex(positions, at(2, 0.1)), 1);
  assert.equal(turnIndex(positions, at(4.1, 2)), 2);
});
