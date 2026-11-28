import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingAt, placedFeature} from './layer-places.js';

const placesFile = 'places.geojson';
const buildingsFile = 'buildings.geojson';

const square = (entityId, size) => ({
  type: 'Feature',
  properties: {entityId, kind: 'building'},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [size, 0],
        [size, size],
        [0, size],
        [0, 0]
      ]
    ]
  }
});

const pointAt = coordinates => ({
  type: 'Feature',
  properties: {name: 'Corner cafe'},
  geometry: {type: 'Point', coordinates}
});

// Only the entries a behavior reads matter here: the buildings under the point and the place being prepared.
function contextWith(buildings, before = null) {
  return {
    entriesOf: filename => (filename === buildingsFile ? buildings.map((feature, index) => ({key: String(index), feature})) : []),
    rules: {layers: {[placesFile]: {properties: {buildingEntityId: {}}}}},
    session: {workingFeature: () => before}
  };
}

test('buildingAt takes the smallest building where footprints overlap', () => {
  const context = contextWith([square('way/1', 10), square('way/2', 2)]);
  assert.equal(buildingAt([0.5, 0.5], context).feature.properties.entityId, 'way/2');
  assert.equal(buildingAt([5, 5], context).feature.properties.entityId, 'way/1');
  assert.equal(buildingAt([11, 11], context), null);
});

test('a new place says which building it is in, or that it stands alone', () => {
  const context = contextWith([square('way/2', 2)]);
  const inside = placedFeature(pointAt([1, 1]), context, {isNew: true, key: 'new'});
  assert.deepEqual(inside.properties, {name: 'Corner cafe', buildingEntityId: 'way/2'});
  const outside = placedFeature(pointAt([3, 3]), context, {isNew: true, key: 'new'});
  assert.deepEqual(outside.properties, {name: 'Corner cafe', standalone: true});
});

test('a moved place changes building, while an untouched one keeps what it says', () => {
  const context = contextWith([square('way/2', 2)], pointAt([1, 1]));
  const moved = placedFeature(pointAt([3, 3]), context, {isNew: false, key: '0'});
  assert.deepEqual(moved.properties, {name: 'Corner cafe', standalone: true});

  const unchanged = pointAt([1, 1]);
  unchanged.properties.buildingEntityId = 'way/9';
  assert.equal(placedFeature(unchanged, contextWith([square('way/2', 2)], unchanged), {isNew: false, key: '0'}), unchanged);
});
