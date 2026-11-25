import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from './map-style.js';
import {basemapColors} from './basemap-palette.js';
import {drawingGroups, drawingGroupKey} from './drawing-order.js';

const walkingLayerIds = ['paths', 'footways', 'park-routes', 'cycleways', 'steps'];
const style = mapStyle('pmtiles://archive', 'https://local.test/');
const filters = walkingLayerIds.map(id => ({id, filter: featureFilter(style.layers.find(layer => layer.id === id).filter)}));

function walkingLayersFor(properties) {
  const feature = {type: 2, properties};
  return filters.filter(({filter}) => filter.filter({zoom: 16}, feature)).map(({id}) => id);
}

// Every walking way gets exactly one walking pattern: two would draw dots over steps or over a park route.
test('each walking path class lands in exactly one walking layer', () => {
  const cases = [
    [{kind: 'footway', pathClass: 'main', inGreenArea: true}, 'park-routes'],
    [{kind: 'cycleway', pathClass: 'main', inGreenArea: true}, 'park-routes'],
    [{kind: 'footway', pathClass: 'main'}, 'footways'],
    [{kind: 'path', pathClass: 'main'}, 'footways'],
    [{kind: 'footway'}, 'paths'],
    [{kind: 'path', inGreenArea: true}, 'paths'],
    [{kind: 'track', pathClass: 'trail', inGreenArea: true}, 'paths'],
    [{kind: 'cycleway', pathClass: 'main'}, 'cycleways'],
    [{kind: 'cycleway', pathClass: 'trail'}, 'cycleways'],
    [{kind: 'steps', pathClass: 'trail'}, 'steps'],
    [{kind: 'steps', inGreenArea: true}, 'steps']
  ];
  for (const [properties, expectedLayer] of cases) {
    assert.deepEqual(walkingLayersFor(properties), [expectedLayer], JSON.stringify(properties));
  }
  assert.deepEqual(walkingLayersFor({kind: 'pedestrian', pathClass: 'trail'}), [], 'a pedestrian street stays a street');
});

for (const prefix of ['/', '/cg-map/']) {
  test(`cartography injects local assets at ${prefix}`, () => {
    const baseURL = `https://local.test${prefix}`;
    const style = mapStyle('pmtiles://archive', baseURL);
    assert.equal(style.glyphs, baseURL + 'fonts/{fontstack}/{range}.pbf');
    assert.equal(style.sources['building-addresses'].data, baseURL + 'data/building-labels.geojson');
    assert.equal(style.sources.basemap.url, 'pmtiles://archive');
    assert.ok(style.layers.some(layer => layer.id === 'steps'));
  });
}

test('every extracted green kind keeps the park fill', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const land = style.layers.find(layer => layer.id === 'land');
  assert.deepEqual(land.paint['fill-color'], [
    'case',
    ['in', ['get', 'kind'], ['literal', [
      'park', 'garden', 'woods', 'meadow', 'grass',
      'scrub', 'sports', 'cemetery', 'playground'
    ]]],
    basemapColors.park,
    basemapColors.land
  ]);
});

// The wiki's bottom-to-top order is a design rule: a layer moved or added out of order breaks this test.
test('basemap layers follow the drawing order', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const groupPositions = style.layers.map(layer => {
    const position = drawingGroups.indexOf(layer.metadata?.[drawingGroupKey]);
    assert.ok(position >= 0, `${layer.id} has no drawing group`);
    return position;
  });
  const isInOrder = groupPositions.every((position, index) => index === 0 || position >= groupPositions[index - 1]);
  assert.ok(isInOrder, style.layers.map(layer => layer.metadata[drawingGroupKey]).join(' → '));
});

test('coastline lines are not styled as waterways', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const rivers = style.layers.find(layer => layer.id === 'rivers');
  assert.deepEqual(rivers.filter, [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['!=', ['get', 'kind'], 'coastline']
  ]);
});
