import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTappedFeature} from '../src/map-selection.js';

const GREEN_LAND_KINDS = [
  'park', 'garden', 'woods', 'meadow', 'grass',
  'scrub', 'sports', 'cemetery', 'playground'
];

test('every extracted green land kind is selectable on the basemap', () => {
  for (const kind of GREEN_LAND_KINDS) {
    const hit = {
      layer: {id: 'land'},
      properties: {kind, name: `Named ${kind}`},
      geometry: {coordinates: [19, 42]}
    };
    const map = {
      queryRenderedFeatures(_point, {layers}) {
        return layers.includes('land') ? [hit] : [];
      }
    };
    const selected = [];
    selectTappedFeature(map, {point: {}, lngLat: {toArray: () => [19, 42]}}, {
      isMapReady: true,
      buildingAddresses: new Map(),
      placeHitLayers: [],
      placesById: new Map(),
      showPlace: () => {},
      showPoint: point => selected.push(point)
    });
    assert.equal(selected.length, 1, kind);
    assert.equal(selected[0].name, `Named ${kind}`, kind);
  }
});
