import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from '../src/map-style.js';
import {installSatellite, setSatelliteVisible, satelliteBounds, satelliteLayerIds} from '../src/satellite.js';

test('satellite uses bounded local imagery below labels and toggles without replacing the map', () => {
  const assetBaseURL = 'https://ivanov-gv.github.io/cg-map/';
  const style = mapStyle(`pmtiles://${assetBaseURL}data/map.pmtiles`, assetBaseURL);
  const map = {
    addSource(id, source) {
      style.sources[id] = source;
    },
    addLayer(layer, before) {
      const insertIndex = style.layers.findIndex(candidate => candidate.id === before);
      assert.ok(insertIndex >= 0);
      style.layers.splice(insertIndex, 0, layer);
    },
    setLayoutProperty(id, key, value) {
      style.layers.find(layer => layer.id === id).layout[key] = value;
    }
  };
  installSatellite(map, assetBaseURL);
  assert.deepEqual(
    validateStyleMin(style).map(error => error.message),
    []
  );
  assert.deepEqual(style.sources['satellite-tiles'].bounds, satelliteBounds);
  assert.ok(style.sources['satellite-tiles'].tiles[0].startsWith(assetBaseURL));
  assert.ok(style.sources['satellite-tiles'].tiles[0].includes('17/{x}/{y}.webp'));
  assert.equal(style.sources['satellite-tiles'].maxzoom, 17);
  for (const id of satelliteLayerIds) {
    assert.equal(style.layers.find(layer => layer.id === id).layout.visibility, 'none');
    assert.ok(
      style.layers.findIndex(layer => layer.id === id) < style.layers.findIndex(layer => layer.id === 'road-labels')
    );
  }
  for (const visible of [true, false]) {
    setSatelliteVisible(map, visible);
    for (const id of satelliteLayerIds)
      assert.equal(style.layers.find(layer => layer.id === id).layout.visibility, visible ? 'visible' : 'none');
  }
});
