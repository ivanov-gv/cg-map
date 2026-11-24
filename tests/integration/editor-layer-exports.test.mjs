import test from 'node:test';
import assert from 'node:assert/strict';
import {HeadlessEditor, newLocalId} from '../editor-exports.mjs';
import {splitRoad} from '../../apps/editor/src/road-shapes.js';

const roundDegrees = value => Number(value.toFixed(6));
const filesOf = operations => [...new Set(operations.map(({filename}) => filename))].toSorted();
const shiftedRings = (rings, offset) => rings.map(ring => ring.map(point => point.map(value => roundDegrees(value + offset))));

test('a moved building takes its address and entrances along and stays importable', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const label = editor.find('building-labels.geojson', ({properties}) => properties.entrances);
  const key = String(label.feature.properties.footprintIndex);
  const building = structuredClone(editor.features('buildings.geojson')[Number(key)]);
  building.geometry.coordinates = shiftedRings(building.geometry.coordinates, 0.00005);
  assert.equal(editor.apply('buildings.geojson', key, building), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['building-entrances.geojson', 'building-labels.geojson', 'buildings.geojson']);
});

test('a deleted building takes its address with it', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const buildings = editor.features('buildings.geojson');
  const usedIds = new Set(
    ['places.geojson', 'building-entrances.geojson'].flatMap(filename =>
      editor.features(filename).map(({properties}) => properties.buildingEntityId)
    )
  );
  const isAlone = ({properties}) => !usedIds.has(buildings[properties.footprintIndex].properties.entityId);
  const label = editor.find('building-labels.geojson', isAlone);
  const key = String(label.feature.properties.footprintIndex);
  assert.equal(editor.remove('buildings.geojson', key), null);
  const operations = await editor.exportAndImport();
  const {entityId} = editor.features('buildings.geojson')[Number(key)].properties;
  assert.ok(!editor.written('buildings.geojson').some(({properties}) => properties.entityId === entityId));
  assert.deepEqual(filesOf(operations), ['building-labels.geojson', 'buildings.geojson']);
});

test('a drawn building with an address, an entrance and a place passes whole', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const buildingId = newLocalId();
  const corners = [
    [19.2, 42.4],
    [19.2004, 42.4],
    [19.2004, 42.4004],
    [19.2, 42.4004],
    [19.2, 42.4]
  ];
  const building = {
    type: 'Feature',
    properties: {kind: 'building', building: 'yes', 'addr:housenumber': '7', 'addr:street': 'Njegoševa'},
    geometry: {type: 'Polygon', coordinates: [corners]}
  };
  assert.equal(editor.apply('buildings.geojson', buildingId, building), null);
  const entrance = {
    type: 'Feature',
    properties: {kind: 'entrance', entrance: 'main', ref: '1', buildingEntityId: buildingId},
    geometry: {type: 'Point', coordinates: [19.2, 42.4002]}
  };
  assert.equal(editor.apply('building-entrances.geojson', newLocalId(), entrance), null);
  const placeId = newLocalId();
  const place = {
    type: 'Feature',
    properties: {
      id: placeId,
      source: editor.context.rules.localPlaceSource,
      name: 'New cafe',
      category: 'food',
      kind: 'cafe',
      visibilityLevel: 4,
      buildingEntityId: buildingId
    },
    geometry: {type: 'Point', coordinates: [19.2002, 42.4002]}
  };
  assert.equal(editor.apply('places.geojson', placeId, place), null);
  await editor.exportAndImport();
  const isNewAddress = ({properties}) =>
    properties['addr:housenumber'] === '7' && properties['addr:street'] === 'Njegoševa';
  const label = editor.written('building-labels.geojson').find(isNewAddress);
  assert.ok(label);
  const written = editor.written('buildings.geojson')[label.properties.footprintIndex];
  assert.equal(written.properties.entityId, buildingId);
});

test('an address with another number and street passes with its building, and a deleted one too', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const isPlain = ({properties}) => properties['addr:housenumber'] && !properties.entrances && !properties.building_number;
  const changed = editor.find('building-labels.geojson', isPlain);
  const after = structuredClone(changed.feature);
  after.properties['addr:housenumber'] = '123';
  assert.equal(editor.apply(changed.filename, changed.key, after), null);
  const deleted = editor.find('building-labels.geojson', (feature, key) => isPlain(feature) && key !== changed.key);
  assert.equal(editor.remove(deleted.filename, deleted.key), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['building-labels.geojson', 'buildings.geojson']);
  const {footprintIndex} = changed.feature.properties;
  assert.equal(editor.written('buildings.geojson')[footprintIndex].properties['addr:housenumber'], '123');
});

test('a place moved into a building belongs to it after the import', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const building = editor.find('buildings.geojson', ({geometry}) => geometry.coordinates[0].length === 5);
  const [ring] = building.feature.geometry.coordinates;
  const middle = [0, 1].map(axis => roundDegrees((ring[0][axis] + ring[2][axis]) / 2));
  const place = editor.find('places.geojson', ({properties}) => properties.buildingEntityId === undefined);
  const moved = {...place.feature, geometry: {type: 'Point', coordinates: middle}};
  assert.equal(editor.apply(place.filename, place.key, moved), null);
  await editor.exportAndImport();
  const written = editor.written('places.geojson').find(({properties}) => properties.id === place.feature.properties.id);
  assert.equal(written.properties.buildingEntityId, building.feature.properties.entityId);
});

test('a split road, a forbidden turn and a traffic light pass in one export', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const ruledWays = new Set(editor.features('turn-restrictions.json').flatMap(({properties}) => [properties.from, properties.to]));
  const isPlain = ({properties, geometry}) =>
    properties.entityId?.startsWith('way/') &&
    properties.endNode &&
    geometry.coordinates.length > 3 &&
    !ruledWays.has(Number(properties.entityId.slice('way/'.length)));
  const split = editor.find('roads.geojson', isPlain);
  const [first, second] = splitRoad(split.feature, 1, editor.context.rules.layers['roads.geojson'].properties);
  assert.equal(editor.apply('roads.geojson', split.key, first), null);
  assert.equal(editor.apply('roads.geojson', newLocalId(), second), null);
  const signed = editor.find('roads.geojson', (feature, key) => isPlain(feature) && key !== split.key);
  const choices = {[`turn:${signed.key}`]: true, hasLight: true};
  assert.equal(editor.apply('roads.geojson', signed.key, signed.feature, choices), null);
  const operations = await editor.exportAndImport();
  assert.ok(filesOf(operations).includes('turn-restrictions.json'));
  const way = Number(signed.feature.properties.entityId.slice('way/'.length));
  const isUTurnRule = ({properties}) => properties.from === way && properties.restriction === 'no_u_turn';
  assert.ok(editor.written('turn-restrictions.json').some(isUTurnRule));
});

test('a deleted road takes its turn rules out of the sources', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const {from} = editor.features('turn-restrictions.json')[0].properties;
  const road = editor.find('roads.geojson', ({properties}) => properties.entityId === `way/${from}`);
  assert.equal(editor.remove('roads.geojson', road.key), null);
  await editor.exportAndImport();
  const rules = editor.written('turn-restrictions.json');
  assert.ok(!rules.some(({properties}) => properties.from === from || properties.to === from));
});
