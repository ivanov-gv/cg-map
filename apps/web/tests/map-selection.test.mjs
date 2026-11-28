import test from 'node:test';
import assert from 'node:assert/strict';
import {roadLayerIds} from './pinned-core.mjs';
import {selectTappedFeature} from '../src/map-selection.js';

const roadLayers = roadLayerIds([
  'steps',
  'cycleways',
  'paths',
  'footways',
  'park-routes',
  'pedestrian-streets',
  'minor-roads',
  'major-roads'
]);
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
      getLayer: () => ({}),
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
      roadLayers,
      showPlace: () => {},
      showPoint: point => selected.push(point)
    });
    assert.equal(selected.length, 1, kind);
    assert.equal(selected[0].name, `Named ${kind}`, kind);
  }
});

function selectFrom(hits, existingLayers) {
  const map = {
    getLayer: id => existingLayers.includes(id),
    queryRenderedFeatures(_point, {layers}) {
      return hits.filter(hit => layers.includes(hit.layer.id));
    }
  };
  const selected = [];
  selectTappedFeature(map, {point: {}, lngLat: {toArray: () => [19, 42]}}, {
    isMapReady: true,
    buildingAddresses: new Map(),
    placeHitLayers: [],
    placesById: new Map(),
    roadLayers,
    showPlace: () => {},
    showPoint: point => selected.push(point)
  });
  return selected[0];
}

// Park šuma Gorica is named only on its protected area: a tap on its unnamed woods or stream picks the area, while a
// named park or lake inside a protected area stays the place.
test('a protected area wins over unnamed woods and water, never over a named park or lake', () => {
  const hit = (layer, properties) => ({layer: {id: layer}, properties, geometry: {coordinates: [19, 42]}});
  const gorica = hit('protected-areas', {kind: 'protected-area', name: 'Park šuma Gorica'});
  const layers = ['land', 'protected-areas', 'water'];
  const woods = hit('land', {kind: 'woods'});
  const stream = hit('water', {kind: 'river'});
  const park = hit('land', {kind: 'park', name: 'Park šuma Ljubović'});
  const lake = hit('water', {kind: 'lake', name: 'Skadarsko jezero'});
  const goricaCard = selectFrom([woods, gorica], layers);
  assert.equal(goricaCard.name, 'Park šuma Gorica');
  assert.equal(goricaCard.kind, 'Protected area');
  assert.equal(selectFrom([stream, gorica], layers).name, 'Park šuma Gorica');
  assert.equal(selectFrom([park, gorica], layers).name, 'Park šuma Ljubović');
  assert.equal(selectFrom([lake, gorica], layers).name, 'Skadarsko jezero');
  // An older map-core has no protected-area layer; the tap still selects the woods instead of failing.
  assert.equal(selectFrom([woods], ['land', 'water']).kind, 'Land');
});

test('road selection queries exactly the road layer ids returned by map-core', () => {
  const publishedRoadLayers = roadLayerIds(['steps', 'major-roads']);
  let geographyQueryLayers = [];
  const map = {
    getLayer: () => true,
    queryRenderedFeatures(_point, {layers}) {
      if (layers.includes('land')) geographyQueryLayers = layers;
      return [];
    }
  };
  selectTappedFeature(map, {point: {}, lngLat: {toArray: () => [19, 42]}}, {
    isMapReady: true,
    buildingAddresses: new Map(),
    placeHitLayers: [],
    placesById: new Map(),
    roadLayers: publishedRoadLayers,
    showPlace: () => {},
    showPoint: () => {}
  });
  assert.deepEqual(geographyQueryLayers, [
    'building-numbers',
    'buildings',
    'road-labels',
    ...publishedRoadLayers,
    'land',
    'protected-areas',
    'water',
    'rivers'
  ]);
});
