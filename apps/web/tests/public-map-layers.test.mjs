import test from 'node:test';
import assert from 'node:assert/strict';
import {markerKeys} from '@ivanov-gv/map-core';
import {searchResultMarkerData} from '../src/public-map-layers.js';

const place = (id, coordinates, visibilityLevel) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {id, name: id, category: 'food', visibilityLevel}
});

test('result markers include below-threshold places and every member of a shared location', () => {
  const levelFive = place('node/1', [19.26, 42.44], 5);
  const levelOne = place('node/2', [19.26, 42.44], 1);
  const separate = place('node/3', [19.27, 42.45], 5);
  const places = [levelFive, levelOne, separate];
  const keys = markerKeys(places);

  const data = searchResultMarkerData(places, keys);

  assert.equal(data.features.length, 2);
  const shared = data.features.find(feature => feature.properties.markerKey === keys.get('node/1'));
  assert.deepEqual(shared.geometry.coordinates, [19.26, 42.44]);
  assert.deepEqual(JSON.parse(shared.properties.activeIds), ['node/2', 'node/1']);
  const isolated = data.features.find(feature => feature.properties.markerKey === 'node/3');
  assert.deepEqual(JSON.parse(isolated.properties.activeIds), ['node/3']);
  assert.ok(data.features.every(feature => feature.properties.icon));
});
