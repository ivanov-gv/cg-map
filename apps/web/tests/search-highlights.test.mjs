import test from 'node:test';
import assert from 'node:assert/strict';
import {SearchHighlights, searchResultMarkerData} from '../src/public-map-layers.js';

// The browser only needs to prove that a rendered outline reacts to a click. Which source or filter changes belong here.
function highlightEnvironment() {
  const sources = new Map();
  const filters = new Map();
  const layout = new Map();
  const writes = [];
  const source = name => {
    if (!sources.has(name)) {
      sources.set(name, {
        setData(data) {
          sources.get(name).data = data;
          writes.push(name);
        }
      });
    }
    return sources.get(name);
  };
  const map = {
    addSource: name => source(name),
    addLayer: layer => {
      layout.set(layer.id, {...layer.layout, visibility: 'visible'});
    },
    getSource: source,
    setFilter: (id, filter) => filters.set(id, filter),
    getLayoutProperty: (id, property) => layout.get(id)[property],
    setLayoutProperty: (id, property, value) => {
      layout.set(id, {...layout.get(id), [property]: value});
    }
  };
  layout.set('search-result-places', {visibility: 'visible'});
  return {highlights: new SearchHighlights(map), sources, filters, layout, writes};
}

const visibleResults = [
  {id: 'cafe', kind: 'place', markerKey: 'shared:cafe', coordinates: [19.26, 42.44]},
  {id: 'other-cafe', kind: 'place', markerKey: 'shared:cafe', coordinates: [19.26, 42.44]},
  {id: 'building', kind: 'building', footprintIndex: 42},
  {id: 'street-a', kind: 'street', streetName: 'Jerevanska'},
  {id: 'street-b', kind: 'street', streetName: 'Jerevanska'}
];

test('result markers cover every match, including low-visibility places beyond the row limit', () => {
  const places = Array.from({length: 41}, (_, index) => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [19.26 + index / 100000, 42.44]},
    properties: {
      id: `place-${index}`,
      name: `Place ${index}`,
      category: 'food',
      visibilityLevel: index % 2 ? 1 : 5
    }
  }));
  const markerKeysById = new Map(places.map((place, index) => [place.properties.id, `marker-${index}`]));
  const markers = searchResultMarkerData(places, markerKeysById).features;

  assert.equal(markers.length, 41);
  assert.deepEqual(
    markers.map(marker => marker.properties.markerKey).sort(),
    [...markerKeysById.values()].sort()
  );
  assert.equal(markers.filter(marker => marker.properties.activeIds === '["place-1"]').length, 1);
});

test('one highlight update writes place rings, building footprints and unique street names', () => {
  const {highlights, sources, filters, writes} = highlightEnvironment();
  highlights.update(visibleResults);
  assert.deepEqual(writes, ['search-place-highlights']);
  assert.deepEqual(
    sources.get('search-place-highlights').data.features.map(feature => feature.properties.markerKey),
    ['shared:cafe']
  );
  assert.deepEqual(filters.get('search-building-outline'), ['in', ['id'], ['literal', [42]]]);
  assert.deepEqual(filters.get('search-street-outline'), ['in', ['get', 'name'], ['literal', ['Jerevanska']]]);
});

test('an unchanged visible set touches no source during camera moves', () => {
  const {highlights, writes} = highlightEnvironment();
  highlights.update(visibleResults);
  highlights.update([...visibleResults]);
  assert.equal(writes.length, 1);
  highlights.update([...visibleResults, {id: 'new', kind: 'street', streetName: 'Other'}]);
  assert.equal(writes.length, 2);
});

test('clearing a query hides the result source and empties every outline filter', () => {
  const {highlights, sources, filters, layout, writes} = highlightEnvironment();
  highlights.setResultMarkers({type: 'FeatureCollection', features: [{}]});
  highlights.update(visibleResults);
  highlights.clear();
  assert.equal(layout.get('search-result-places').visibility, 'none');
  assert.deepEqual(sources.get('search-place-highlights').data.features, []);
  assert.deepEqual(filters.get('search-building-outline'), ['in', ['id'], ['literal', []]]);
  assert.deepEqual(filters.get('search-street-outline'), ['in', ['get', 'name'], ['literal', []]]);
  assert.equal(writes.length, 3);
});
