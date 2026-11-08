import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseVisibilityConfig} from '@ivanov-gv/map-core';
import {EditPreview, previewLayers} from '../src/edit-preview.js';

const visibilityConfig = parseVisibilityConfig(
  JSON.parse(fs.readFileSync(new URL('../../../packages/contracts/place-visibility.json', import.meta.url)))
);
const road = (name, coordinates) => ({
  type: 'Feature',
  properties: {kind: 'residential', name},
  geometry: {type: 'LineString', coordinates}
});
const place = (id, name) => ({
  type: 'Feature',
  properties: {id, name, category: 'food', kind: 'cafe', visibilityLevel: 3},
  geometry: {type: 'Point', coordinates: [19.26, 42.44]}
});
const minorRoads = {
  id: 'minor-roads',
  type: 'line',
  source: 'basemap',
  'source-layer': 'roads',
  minzoom: 11,
  filter: ['==', ['get', 'kind'], 'residential'],
  paint: {'line-color': '#fffef8'}
};
const roadLabels = {id: 'road-labels', type: 'symbol', source: 'basemap', 'source-layer': 'roads', layout: {}};

// Records what the preview does to a map, with just enough behavior to read its own changes back.
function fakeMap() {
  const layers = [minorRoads, roadLabels, {id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings'}];
  const sources = {
    places: {data: {type: 'FeatureCollection', features: []}},
    'building-addresses': {data: 'data/building-labels.geojson'}
  };
  const filters = new Map(layers.map(layer => [layer.id, layer.filter]));
  const map = {
    layers,
    sources,
    filters,
    getStyle: () => ({layers, sources: Object.fromEntries(Object.entries(sources).map(([id, {data}]) => [id, {data}]))}),
    getSource: id => ({setData: data => (sources[id].data = data)}),
    addSource: (id, specification) => (sources[id] = specification),
    removeSource: id => delete sources[id],
    addLayer: (layer, beforeId) => layers.splice(layers.findIndex(({id}) => id === beforeId), 0, layer),
    removeLayer: id => layers.splice(layers.findIndex(layer => layer.id === id), 1),
    getFilter: id => filters.get(id),
    setFilter: (id, filter) => filters.set(id, filter)
  };
  return map;
}

const basemapLayers = {'roads.geojson': ['minor-roads', 'road-labels'], 'buildings.geojson': ['buildings']};

test('a preview layer draws like the published one, from its own source', () => {
  const [copy] = previewLayers([minorRoads], 'edit-preview-roads.geojson');
  const expected = {...minorRoads, id: 'edit-preview-minor-roads', source: 'edit-preview-roads.geojson'};
  delete expected['source-layer'];
  assert.deepEqual(copy, expected);
  assert.equal(minorRoads['source-layer'], 'roads', 'the published layer itself is untouched');
});

test('a changed file is drawn from its working features below its hidden published layers, and comes back on hide', () => {
  const map = fakeMap();
  const preview = new EditPreview({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const renamed = road('Renamed street', [
    [19.26, 42.44],
    [19.27, 42.44]
  ]);
  preview.show(new Map([['roads.geojson', [renamed]]]));
  assert.equal(preview.isShown, true);
  assert.deepEqual(map.sources['edit-preview-roads.geojson'].data.features, [renamed]);
  assert.deepEqual(
    map.layers.map(({id}) => id),
    ['edit-preview-minor-roads', 'minor-roads', 'edit-preview-road-labels', 'road-labels', 'buildings']
  );
  assert.deepEqual(map.filters.get('minor-roads'), ['==', ['literal', 1], 0]);
  assert.equal(map.filters.get('buildings'), undefined, 'an unchanged file keeps its published layers');

  preview.hide();
  assert.equal(preview.isShown, false);
  assert.deepEqual(
    map.layers.map(({id}) => id),
    ['minor-roads', 'road-labels', 'buildings']
  );
  assert.equal(map.sources['edit-preview-roads.geojson'], undefined);
  assert.deepEqual(map.filters.get('minor-roads'), minorRoads.filter);
});

test('places and building labels are previewed through their own sources, and restored to the published data', () => {
  const map = fakeMap();
  const published = [place('node/1', 'Published cafe')];
  const preview = new EditPreview({map, basemapLayers, visibilityConfig, publishedPlaces: published});
  const label = {
    type: 'Feature',
    properties: {kind: 'building', 'addr:housenumber': '7'},
    geometry: {type: 'Point', coordinates: [19.26, 42.44]}
  };
  preview.show(
    new Map([
      ['places.geojson', [place('node/1', 'Renamed cafe')]],
      ['building-labels.geojson', [label]]
    ])
  );
  const previewedLabels = JSON.parse(map.sources.places.data.features[0].properties.activeIds);
  assert.deepEqual(previewedLabels, ['node/1']);
  assert.equal(map.sources.places.data.features[0].properties.label, 'Renamed cafe');
  assert.deepEqual(map.sources['building-addresses'].data.features, [label]);

  preview.hide();
  assert.equal(map.sources.places.data.features[0].properties.label, 'Published cafe');
  assert.equal(map.sources['building-addresses'].data, 'data/building-labels.geojson');
});

test('showing again replaces the previous preview instead of drawing it twice', () => {
  const map = fakeMap();
  const preview = new EditPreview({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const edited = new Map([['roads.geojson', [road('Once', [[19.26, 42.44], [19.27, 42.44]])]]]);
  preview.show(edited);
  preview.show(edited);
  assert.equal(map.layers.filter(({id}) => id === 'edit-preview-minor-roads').length, 1);
  preview.hide();
  assert.deepEqual(map.filters.get('minor-roads'), minorRoads.filter, 'the published filter survives a second show');
});
