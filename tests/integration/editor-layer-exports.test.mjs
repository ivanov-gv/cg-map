import test from 'node:test';
import assert from 'node:assert/strict';
import {HeadlessEditor, newLocalId} from '../editor-exports.mjs';

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
