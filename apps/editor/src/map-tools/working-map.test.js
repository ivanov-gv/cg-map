import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapStyle, parseVisibilityConfig} from '@ivanov-gv/map-core';
import {installInspectionLayers} from '../source-data/inspection-layers.js';
import {basemapLayersFromStyle, previewLayersFromStyle, surfacePreviewFeatures} from './basemap-layers.js';
import {WorkingMap, hiddenLayerFilter, previewLayers} from './working-map.js';

const visibilityConfig = parseVisibilityConfig(
  JSON.parse(fs.readFileSync(new URL(import.meta.resolve('@ivanov-gv/map-contracts/place-visibility.json'))))
);
// The fixture is this app's copy of the rules used by the fixture city: it matches the pinned contracts for the new
// files and keeps ridges view-only until #490. It is the source of the file, operation and property list below, never
// a fixture of the cartography under test.
const editorRules = JSON.parse(fs.readFileSync(new URL('../../tests/fixtures/editor-layers.json', import.meta.url)));
const publishedStyle = mapStyle('pmtiles://fixture', 'https://example.test/');
// The same derivation the runtime uses: one fact about which source layer draws a file, no second table to drift.
const publishedLayersByFile = basemapLayersFromStyle(publishedStyle.layers);
const publishedLayerIdsOf = filename => publishedLayersByFile[filename] ?? [];
const workingSourceByFile = {'places.geojson': 'places', 'building-labels.geojson': 'building-addresses'};
const previewPrefix = 'edit-preview-';
const featureCollection = features => ({type: 'FeatureCollection', features});

const geometryOf = geometryType => {
  if (geometryType === 'None') return null;
  if (geometryType === 'Point') return {type: 'Point', coordinates: [19.26, 42.44]};
  if (geometryType === 'LineString') return {type: 'LineString', coordinates: [[19.26, 42.44], [19.27, 42.44]]};
  return {
    type: 'Polygon',
    coordinates: [[[19.26, 42.44], [19.27, 42.44], [19.27, 42.45], [19.26, 42.44]]]
  };
};
const workingFeatureOf = (filename, operation, rule) => {
  if (filename === 'places.geojson') return place(`node/${operation}`, `Edited ${operation}`);
  return {
    type: 'Feature',
    properties:
      filename === 'building-labels.geojson'
        ? {operation, sourceFile: filename, kind: 'building', 'addr:housenumber': '7'}
        : {operation, sourceFile: filename},
    geometry: geometryOf(rule.geometries[0] ?? 'Polygon')
  };
};
// A property edit keeps geometry and file identity but changes a value. Values come from the rule, so adding a
// property to a rule adds a preview case without editing this test. The working feature's own properties win, so a
// shared-source marker still carries its sourceFile and a place still carries publishable values.
const editedValueOf = definition => {
  if (definition.enum) return definition.enum[0];
  if (definition.type === 'boolean') return true;
  if (definition.type === 'integer' || definition.type === 'number') return definition.minimum ?? 0;
  return 'Edited property';
};
const propertyEditOf = (feature, rule) => ({
  ...feature,
  properties: {
    ...Object.fromEntries(
      Object.entries(rule.properties).map(([name, definition]) => [name, editedValueOf(definition)])
    ),
    ...feature.properties
  }
});
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
const defaultLayers = [minorRoads, roadLabels, {id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings'}];

function fakeMap(styleLayers = defaultLayers) {
  const layers = [...styleLayers];
  const sources = {
    basemap: {data: ''},
    places: {data: featureCollection([])},
    'building-addresses': {data: 'data/building-labels.geojson'},
    'editor-source': {data: featureCollection([])},
    'editor-applied': {data: featureCollection([])}
  };
  const filters = new Map(layers.map(layer => [layer.id, layer.filter]));
  const map = {
    layers,
    sources,
    filters,
    addLayerCalls: 0,
    setFilterCalls: 0,
    getStyle: () => ({layers, sources: Object.fromEntries(Object.entries(sources).map(([id, {data}]) => [id, {data}]))}),
    getLayer: id => layers.find(layer => layer.id === id),
    getSource: id => ({setData: data => (sources[id].data = data)}),
    addSource: (id, specification) => (sources[id] = specification),
    removeSource: id => delete sources[id],
    addLayer: (layer, beforeId) => {
      map.addLayerCalls += 1;
      const index = beforeId ? layers.findIndex(({id}) => id === beforeId) : -1;
      if (index < 0) layers.push(layer);
      else layers.splice(index, 0, layer);
    },
    removeLayer: id => layers.splice(layers.findIndex(layer => layer.id === id), 1),
    getFilter: id => filters.get(id),
    setFilter: (id, filter) => {
      map.setFilterCalls += 1;
      filters.set(id, filter);
    }
  };
  return map;
}

// A shared-source layer carries its own filename alongside the published filter.
const filterDrawsFile = (filter, filename) => {
  if (!Array.isArray(filter)) return false;
  const isOwnFile =
    filter.length === 3 &&
    JSON.stringify(filter[1]) === JSON.stringify(['get', 'sourceFile']) &&
    filter[2] === filename;
  return isOwnFile || filter.some(part => filterDrawsFile(part, filename));
};
const previewOf = (map, publishedId, filename) =>
  map
    .getStyle()
    .layers.find(layer => layer.id.startsWith(previewPrefix + publishedId) && filterDrawsFile(layer.filter, filename));
const inspectionOf = (map, filename) =>
  map.getStyle().layers.find(layer => layer.id.startsWith('editor-') && filterDrawsFile(layer.filter, filename));
const sourceHasFeature = (map, sourceId, feature) =>
  map.sources[sourceId].data.features.some(candidate => candidate === feature);
const assertPublishedPreview = (map, filename, feature, publishedIds, edit) => {
  for (const publishedId of publishedIds) {
    const copy = previewOf(map, publishedId, filename);
    assert.ok(copy, `${edit} is copied from the published layer ${publishedId}`);
    assert.equal(copy.source, 'editor-source');
    assert.deepEqual(map.getFilter(publishedId), hiddenLayerFilter, `${publishedId} is hidden while editing`);
  }
  assert.ok(sourceHasFeature(map, 'editor-source', feature), `${edit} is in the drawing source`);
};
const assertWorkingSource = (map, filename, feature, edit) => {
  const sourceId = workingSourceByFile[filename];
  if (filename === 'places.geojson') {
    assert.ok(
      map.sources[sourceId].data.features.some(marker =>
        JSON.parse(marker.properties.activeIds).includes(feature.properties.id)
      ),
      `${edit} is in the place markers`
    );
  } else {
    assert.ok(sourceHasFeature(map, sourceId, feature), `${edit} is in the label source`);
  }
};

const basemapLayers = {'roads.geojson': ['minor-roads', 'road-labels'], 'buildings.geojson': ['buildings']};

test('a preview layer draws like the published one, from its own source', () => {
  const [copy] = previewLayers([minorRoads], 'edit-preview-roads.geojson');
  const expected = {...minorRoads, id: 'edit-preview-minor-roads', source: 'edit-preview-roads.geojson'};
  delete expected['source-layer'];
  assert.deepEqual(copy, expected);
  assert.equal(minorRoads['source-layer'], 'roads', 'the published layer itself is untouched');
});

test('bridge decks and railways are previewed from the style layers map-core publishes for them', () => {
  assert.deepEqual(publishedLayerIdsOf('bridges.geojson'), ['bridge-decks', 'bridge-deck-edges']);
  assert.deepEqual(publishedLayerIdsOf('railways.geojson'), [
    'platform-areas',
    'platform-lines',
    'rail-casing',
    'rail-ties',
    'disused-rail',
    'railway-halts',
    'railway-stations'
  ]);
});

test('a version 5 surface preview reuses the published layers for the whole file', () => {
  const byFile = previewLayersFromStyle(publishedStyle.layers, 5);
  const surfaceLayers = byFile['surface.geojson'];
  for (const id of ['land', 'meadows', 'park-names', 'protected-areas', 'water', 'rivers']) {
    assert.ok(surfaceLayers.includes(id), `${id} draws the stored surface`);
  }
  assert.equal(byFile['surface-green.geojson'], undefined, 'there are no synthetic surface files');
  assert.equal(byFile['surface-water.geojson'], undefined);
  assert.equal(byFile['surface-frame.geojson'], undefined);
  assert.equal(previewLayersFromStyle(publishedStyle.layers, 3)['surface.geojson'], undefined);
});

test('a version 5 surface gets one source per published layer, each drawn from the whole file', () => {
  const map = fakeMap(publishedStyle.layers);
  const preview = new WorkingMap({
    map,
    visibilityConfig,
    publishedPlaces: [],
    previewFeaturesByFile: new Map([['surface.geojson', surfacePreviewFeatures]])
  });
  const park = {
    type: 'Feature',
    properties: {kind: 'park', labelLine: [[19.26, 42.44], [19.27, 42.44]]},
    geometry: geometryOf('Polygon')
  };
  const municipality = {
    type: 'Feature',
    properties: {kind: 'municipality', labelPoint: [19.3, 42.4]},
    geometry: geometryOf('Polygon')
  };
  const lake = {type: 'Feature', properties: {kind: 'lake', iconPoint: [19.35, 42.45]}, geometry: geometryOf('Polygon')};
  const sea = {type: 'Feature', properties: {kind: 'sea'}, geometry: geometryOf('Polygon')};
  preview.show(new Map([['surface.geojson', [park, municipality, lake, sea]]]));

  const drawn = publishedId => map.sources[`edit-preview-surface.geojson-${publishedId}`].data.features;
  assert.deepEqual(drawn('land'), [park, municipality], 'municipalities are land, not dropped');
  assert.deepEqual(drawn('meadows'), [park, municipality]);
  assert.deepEqual(drawn('water'), [lake, sea], 'the sea is water, not land fill');
  assert.deepEqual(drawn('rivers'), [lake, sea]);
  assert.deepEqual(drawn('protected-areas'), []);
  assert.deepEqual(drawn('park-names'), [{...park, geometry: {type: 'LineString', coordinates: park.properties.labelLine}}]);
  assert.equal(map.sources['edit-preview-surface.geojson'], undefined, 'there is no single filtered copy');

  preview.show(new Map([['surface.geojson', [park, municipality, lake, sea]]]));
  assert.deepEqual(drawn('land'), [park, municipality], 'a later layer keeps the earlier working file');
  preview.hide();
  assert.equal(map.sources['edit-preview-surface.geojson-land'], undefined);
});

test('a changed file is drawn from its working features below its hidden published layers, and comes back on hide', () => {
  const map = fakeMap();
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const renamed = road('Renamed street', [
    [19.26, 42.44],
    [19.27, 42.44]
  ]);
  preview.show(new Map([['roads.geojson', [renamed]]]));
  assert.deepEqual(map.sources['edit-preview-roads.geojson'].data.features, [renamed]);
  assert.deepEqual(
    map.layers.map(({id}) => id),
    ['edit-preview-minor-roads', 'minor-roads', 'edit-preview-road-labels', 'road-labels', 'buildings']
  );
  assert.deepEqual(map.filters.get('minor-roads'), ['==', ['literal', 1], 0]);
  assert.equal(map.filters.get('buildings'), undefined, 'an unchanged file keeps its published layers');

  preview.hide();
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
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: published});
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
  const previewedPlaceIds = JSON.parse(map.sources.places.data.features[0].properties.activeIds);
  assert.deepEqual(previewedPlaceIds, ['node/1']);
  assert.equal(map.sources.places.data.features[0].properties.label, 'Renamed cafe');
  assert.deepEqual(map.sources['building-addresses'].data.features, [label]);

  preview.hide();
  assert.equal(map.sources.places.data.features[0].properties.label, 'Published cafe');
  assert.equal(map.sources['building-addresses'].data, 'data/building-labels.geojson');
});

test('a place the public map would refuse leaves the map untouched and the preview hidden', () => {
  const map = fakeMap();
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const layersBefore = map.layers.map(({id}) => id);
  const unpublishable = place('node/2', 'Unpublishable');
  unpublishable.properties.visibilityLevel = 0;
  const edits = new Map([
    ['roads.geojson', [road('Edited', [[19.26, 42.44], [19.27, 42.44]])]],
    ['places.geojson', [unpublishable]]
  ]);
  assert.throws(() => preview.show(edits));
  assert.deepEqual(map.layers.map(({id}) => id), layersBefore);
  assert.deepEqual(map.filters.get('minor-roads'), minorRoads.filter);
  assert.equal(map.sources['edit-preview-roads.geojson'], undefined);
});

test('showing again replaces the previous preview instead of drawing it twice', () => {
  const map = fakeMap();
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const edited = new Map([['roads.geojson', [road('Once', [[19.26, 42.44], [19.27, 42.44]])]]]);
  preview.show(edited);
  preview.show(edited);
  assert.equal(map.layers.filter(({id}) => id === 'edit-preview-minor-roads').length, 1);
  preview.hide();
  assert.deepEqual(map.filters.get('minor-roads'), minorRoads.filter, 'the published filter survives a second show');
});

test('showing the same files again updates the source without rebuilding the preview layers', () => {
  const map = fakeMap();
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  const first = road('First', [
    [19.26, 42.44],
    [19.27, 42.44]
  ]);
  preview.show(new Map([['roads.geojson', [first]]]));
  const addedLayers = map.addLayerCalls;
  const filterWrites = map.setFilterCalls;

  const second = road('Second', [
    [19.26, 42.45],
    [19.27, 42.45]
  ]);
  preview.show(new Map([['roads.geojson', [second]]]));
  assert.equal(map.addLayerCalls, addedLayers, 'the copied layers are kept');
  assert.equal(map.setFilterCalls, filterWrites, 'the published filters stay hidden once');
  assert.deepEqual(map.sources['edit-preview-roads.geojson'].data.features, [second]);

  preview.hide();
  assert.deepEqual(map.filters.get('minor-roads'), minorRoads.filter);
  assert.equal(map.getLayer('edit-preview-minor-roads'), undefined);
});

// The rules are the list of possible edits: every operation and every property change. The pinned core style is the
// list of published layers. Neither is copied into this test. Files the style does not draw keep the editor's
// inspection layer, and derived files the amber applied outline.
test('every file and edit kind in the rules gets a preview from the map style or the editor', () => {
  const rulesByFile = Object.entries(editorRules.layers);
  const editsByFile = new Map(
    rulesByFile.map(([filename, rule]) => [
      filename,
      [
        ...rule.operations.map(operation => ({operation, feature: workingFeatureOf(filename, operation, rule)})),
        ...(Object.keys(rule.properties).length
          ? [{operation: 'property change', feature: propertyEditOf(workingFeatureOf(filename, 'modify', rule), rule)}]
          : [])
      ]
    ])
  );
  const allFeatures = [...editsByFile.values()].flatMap(entries => entries.map(({feature}) => feature));
  const map = fakeMap([
    ...publishedStyle.layers,
    {id: 'editor-applied-line', type: 'line', source: 'editor-applied'}
  ]);
  installInspectionLayers(map, 'editor-source');
  map.sources['editor-source'].data = featureCollection(allFeatures);
  map.sources['editor-applied'].data = featureCollection(allFeatures.filter(({geometry}) => geometry));
  const preview = new WorkingMap({map, visibilityConfig, publishedPlaces: [], sharedSource: 'editor-source'});
  preview.show(
    new Map([...editsByFile].map(([filename, entries]) => [filename, entries.map(({feature}) => feature)])),
    new Set(editsByFile.keys())
  );

  for (const [filename, rule] of rulesByFile) {
    for (const {operation, feature} of editsByFile.get(filename)) {
      const edit = `${filename} ${operation}`;
      if (!feature.geometry) {
        // Route and turn records have no geometry to draw; Changes and the inspector present them instead.
        assert.equal(publishedLayerIdsOf(filename).length, 0, `${edit} has no published geometry layer`);
        assert.equal(inspectionOf(map, filename), undefined, `${edit} has no inspection layer`);
        continue;
      }
      const publishedIds = publishedLayerIdsOf(filename);
      if (publishedIds.length) {
        assertPublishedPreview(map, filename, feature, publishedIds, edit);
      } else if (workingSourceByFile[filename]) {
        assertWorkingSource(map, filename, feature, edit);
      } else if (inspectionOf(map, filename)) {
        assert.ok(sourceHasFeature(map, 'editor-source', feature), `${edit} is in the inspection source`);
      } else {
        assert.ok(rule.derivedGeometry, `${filename} has no way to show ${edit}`);
        assert.ok(sourceHasFeature(map, 'editor-applied', feature), `${edit} is in the applied outline`);
      }
    }
  }
});

test('land and protected areas share park names but keep their own previews and one hidden original', () => {
  const map = fakeMap(publishedStyle.layers);
  installInspectionLayers(map, 'editor-source');
  const land = {type: 'Feature', properties: {sourceFile: 'land.geojson'}, geometry: geometryOf('Polygon')};
  const area = {type: 'Feature', properties: {sourceFile: 'protected-areas.geojson'}, geometry: geometryOf('Polygon')};
  map.sources['editor-source'].data = featureCollection([land, area]);
  const publishedFilter = ['==', ['get', 'kind'], 'park'];
  map.setFilter('park-names', publishedFilter);
  const preview = new WorkingMap({map, visibilityConfig, publishedPlaces: [], sharedSource: 'editor-source'});
  preview.show(
    new Map([
      ['land.geojson', [land]],
      ['protected-areas.geojson', [area]]
    ]),
    new Set(['land.geojson', 'protected-areas.geojson'])
  );

  const landNames = map.getLayer('edit-preview-park-names');
  const areaNames = map.getLayer('edit-preview-park-names-protected-areas.geojson');
  assert.ok(landNames);
  assert.ok(areaNames);
  assert.notEqual(landNames.id, areaNames.id);
  assert.equal(landNames.source, 'editor-source');
  assert.equal(areaNames.source, 'editor-source');
  assert.ok(filterDrawsFile(landNames.filter, 'land.geojson'));
  assert.ok(filterDrawsFile(areaNames.filter, 'protected-areas.geojson'));
  assert.deepEqual(map.getFilter('park-names'), hiddenLayerFilter);

  preview.hide();
  assert.deepEqual(map.getFilter('park-names'), publishedFilter);
  assert.equal(map.getLayer(landNames.id), undefined);
  assert.equal(map.getLayer(areaNames.id), undefined);
});

test('a new shared-place visibility band is rendered in public order and removed when leaving the mode', () => {
  const map = fakeMap();
  const first = place('node/1', 'Neighbourhood cafe');
  const second = place('node/2', 'Street cafe');
  second.properties.visibilityLevel = 4;
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: []});
  preview.show(new Map([['places.geojson', [first, second]]]));
  const names = map.getLayer('place-names-3-4');
  const icons = map.getLayer('place-icons-3-4');
  assert.equal(names.minzoom, 15);
  assert.equal(names.maxzoom, 16);
  assert.equal(icons.minzoom, 15);
  assert.equal(icons.maxzoom, 16);
  assert.deepEqual(icons.filter, ['==', ['get', 'band'], '3-4']);
  assert.ok(map.layers.indexOf(names) < map.layers.indexOf(icons));
  assert.ok(map.layers.indexOf(icons) < map.layers.indexOf(map.getLayer('road-labels')));
  assert.ok(preview.layerIds.includes(icons.id));
  preview.hide();
  assert.equal(map.getLayer(icons.id), undefined);
  assert.equal(map.getLayer(names.id), undefined);
  assert.deepEqual(map.layers.map(layer => layer.id), ['minor-roads', 'road-labels', 'buildings']);
});

test('files of the active layer share the guide source, each drawing only its own features, and others have their own', () => {
  const map = fakeMap();
  map.sources['editor-source'] = {data: {type: 'FeatureCollection', features: []}};
  const preview = new WorkingMap({map, basemapLayers, visibilityConfig, publishedPlaces: [], sharedSource: 'editor-source'});
  const edits = new Map([
    ['buildings.geojson', []],
    ['roads.geojson', []]
  ]);
  preview.show(edits, new Set(['buildings.geojson']));
  const buildings = map.getLayer('edit-preview-buildings');
  assert.equal(buildings.source, 'editor-source');
  assert.deepEqual(buildings.filter, ['==', ['get', 'sourceFile'], 'buildings.geojson']);
  assert.equal(map.getLayer('edit-preview-minor-roads').source, 'edit-preview-roads.geojson');
  assert.equal(map.sources['edit-preview-buildings.geojson'], undefined);
  preview.hide();
  assert.ok(map.sources['editor-source']);
});
