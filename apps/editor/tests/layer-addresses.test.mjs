import test from 'node:test';
import assert from 'node:assert/strict';
import {addressBehaviors, buildingsWithoutNumber, nearestGap} from '../src/layer-addresses.js';
import {buildingAt, placeBehaviors} from '../src/layer-places.js';
import {matchingStreets, streetsNear} from '../src/street-choices.js';

const square = (west, size = 0.001) => [
  [west, 42.44],
  [west + size, 42.44],
  [west + size, 42.44 + size],
  [west, 42.44 + size],
  [west, 42.44]
];
const building = (entityId, west, properties = {}, size = 0.001) => ({
  type: 'Feature',
  properties: {kind: 'building', entityId, ...properties},
  geometry: {type: 'Polygon', coordinates: [square(west, size)]}
});
const address = (properties, coordinates = [19.2505, 42.4405]) => ({
  type: 'Feature',
  properties: {kind: 'building', ...properties},
  geometry: {type: 'Point', coordinates}
});
const road = (name, latitude) => ({
  type: 'Feature',
  properties: {kind: 'residential', name},
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.24, latitude],
      [19.26, latitude]
    ]
  }
});

function contextWith(featuresByFile) {
  const entriesOf = filename =>
    (featuresByFile[filename] ?? []).map((feature, index) => ({filename, key: String(index), feature}));
  return {
    entriesOf,
    findEntity: (filename, entityId) => entriesOf(filename).find(({feature}) => feature.properties.entityId === entityId),
    rules: {layers: {'places.geojson': {properties: {buildingEntityId: {}}}}},
    session: {workingFeature: () => null}
  };
}

const behavior = addressBehaviors['building-labels.geojson'];

test('an address edit keeps its building in step, and nothing else of the building changes', () => {
  const context = contextWith({'buildings.geojson': [building('way/1', 19.25, {nohousenumber: 'yes', name: 'Hall'})]});
  const before = address({footprintIndex: 0, 'addr:housenumber': '14'});
  const after = address({footprintIndex: 0, 'addr:housenumber': '16', 'addr:street': 'Main street'});
  const [edit] = behavior.companionEdits({feature: after, before}, context);
  assert.deepEqual(edit.after.properties, {
    kind: 'building',
    entityId: 'way/1',
    name: 'Hall',
    'addr:housenumber': '16',
    'addr:street': 'Main street'
  });
  assert.deepEqual(behavior.companionEdits({feature: before, before}, context), []);
});

test('a dragged address stops at the wall of its building', () => {
  const context = contextWith({'buildings.geojson': [building('way/1', 19.25)]});
  const feature = address({footprintIndex: 0});
  const inside = {type: 'Point', coordinates: [19.2509, 42.4409]};
  const outside = {type: 'Point', coordinates: [19.252, 42.4409]};
  const edit = {feature, previousGeometry: feature.geometry};
  assert.equal(behavior.limitedGeometry(inside, edit, context), inside);
  assert.equal(behavior.limitedGeometry(outside, edit, context), feature.geometry);
});

test('only buildings whose number is unknown are gaps, and the nearest comes next', () => {
  const context = contextWith({
    'buildings.geojson': [
      building('way/1', 19.25),
      building('way/2', 19.26, {'addr:housenumber': '2'}),
      building('way/3', 19.27, {nohousenumber: 'yes'}),
      building('way/4', 19.28),
      building('way/5', 19.3)
    ],
    'building-labels.geojson': [address({footprintIndex: 0, 'addr:housenumber': '1'})]
  });
  const gaps = buildingsWithoutNumber(context);
  assert.deepEqual(gaps.map(({key}) => key), ['3', '4']);
  assert.equal(nearestGap(gaps, [19.29, 42.44]).key, '3');
  assert.equal(nearestGap(gaps, [19.29, 42.44], new Set(['3'])).key, '4');
  assert.equal(nearestGap(gaps, [19.29, 42.44], new Set(['3', '4'])), null);
});

test('streets come from the roads, one entry per name, nearest first', () => {
  const roads = [road('Far street', 42.46), road('Near street', 42.4401), road('Near street', 42.45), road('', 42.44)].map(
    feature => ({feature})
  );
  const streets = streetsNear(roads, [19.25, 42.44]);
  assert.deepEqual(streets.map(({name}) => name), ['Near street', 'Far street']);
  assert.ok(streets[0].distanceMetres > 10 && streets[0].distanceMetres < 12);
  assert.deepEqual(matchingStreets(streets, ' FAR').map(({name}) => name), ['Far street']);
});

test('a placed or moved place belongs to the smallest building it is on, or stands on its own', () => {
  const context = contextWith({
    'buildings.geojson': [building('way/1', 19.25), building('way/2', 19.25, {}, 0.0004)]
  });
  assert.equal(buildingAt([19.2502, 42.4402], context).feature.properties.entityId, 'way/2');
  const place = coordinates => ({
    type: 'Feature',
    properties: {name: 'Cafe', standalone: true, buildingEntityId: 'way/9'},
    geometry: {type: 'Point', coordinates}
  });
  const {prepared} = placeBehaviors['places.geojson'];
  const edit = {isNew: true, key: 'local:1'};
  assert.deepEqual(prepared(place([19.2508, 42.4408]), context, edit).properties, {name: 'Cafe', buildingEntityId: 'way/1'});
  assert.deepEqual(prepared(place([19.3, 42.4408]), context, edit).properties, {name: 'Cafe', standalone: true});
  const unmoved = place([19.3, 42.44]);
  const openContext = {...context, session: {workingFeature: () => unmoved}};
  assert.equal(prepared(unmoved, openContext, {isNew: false, key: '0'}), unmoved, 'an unmoved place keeps what it says');
});
