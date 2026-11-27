import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle, basemapColors, drawingGroups, drawingGroupKey} from './index.js';

const walkingLayerIds = ['paths', 'footways', 'park-routes', 'cycleways', 'steps'];
const walkingStyle = mapStyle('pmtiles://archive', 'https://local.test/');
const filters = walkingLayerIds.map(id => ({id, filter: featureFilter(walkingStyle.layers.find(layer => layer.id === id).filter)}));

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

// One outline carries every road of a crossing, so the deck must not come back as a widened road stroke.
test('one bridge outline draws a grey deck fill with a dark edge from the bridges layer', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const deck = style.layers.find(layer => layer.id === 'bridge-decks');
  const edge = style.layers.find(layer => layer.id === 'bridge-deck-edges');
  assert.ok(deck, 'bridge-decks is missing');
  assert.ok(edge, 'bridge-deck-edges is missing');
  assert.equal(deck.type, 'fill');
  assert.equal(edge.type, 'line');
  assert.equal(deck.source, 'basemap');
  assert.equal(edge.source, 'basemap');
  assert.equal(deck['source-layer'], 'bridges');
  assert.equal(edge['source-layer'], 'bridges');
  assert.equal(deck.paint['fill-color'], basemapColors.bridgeDeck);
  assert.equal(edge.paint['line-color'], basemapColors.bridgeDeckEdge);
  assert.ok(edge.paint['line-width'] > 0);
});

test('bridge decks sit above ground and water but below every road', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const deck = positionOf('bridge-decks');
  const edge = positionOf('bridge-deck-edges');
  const belowDeck = ['land', 'canyon-rims', 'water', 'buildings'].map(positionOf);
  const roads = [
    'road-casing', 'minor-casing', 'minor-roads', 'pedestrian-streets', 'major-roads',
    'paths', 'footways', 'park-routes', 'cycleways', 'steps'
  ].map(positionOf);
  assert.ok(deck >= 0 && edge > deck, `deck ${deck}, edge ${edge}`);
  for (const index of belowDeck) assert.ok(index >= 0 && index < deck, `layer ${index} is not below the deck`);
  for (const index of roads) assert.ok(index > edge, `road ${index} is not above the deck`);
  assert.ok(drawingGroups.indexOf('bridges') < drawingGroups.indexOf('streets'));
});

test('bridge drawing uses outlines instead of bridge-tagged roads', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const bridgeGroup = style.layers
    .filter(layer => layer.metadata?.[drawingGroupKey] === 'bridges')
    .map(layer => layer.id);
  assert.deepEqual(bridgeGroup, ['bridge-decks', 'bridge-deck-edges']);
  for (const layer of style.layers) {
    assert.ok(!JSON.stringify(layer.filter ?? []).includes('"bridge"'), `${layer.id} still selects bridge roads`);
  }
});

const railwayTrackLayerIds = ['platform-areas', 'platform-lines', 'rail-casing', 'rail-ties', 'disused-rail'];
const railwayLabelLayerIds = ['railway-stations', 'railway-halts'];
const railwayLayerIds = [...railwayTrackLayerIds, ...railwayLabelLayerIds];

function railwayLayers() {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  return Object.fromEntries(
    railwayLayerIds.map(id => [id, style.layers.find(layer => layer.id === id)])
  );
}

function railwayLayersFor(layers, feature) {
  return railwayLayerIds.filter(id => featureFilter(layers[id].filter).filter({zoom: 16}, feature));
}

// The data publishes one `railways` source with a `kind`; each drawing layer must select its own geometry and kind.
test('railway layers read the railways source and separate their kinds', () => {
  const layers = railwayLayers();
  for (const id of railwayLayerIds) {
    assert.ok(layers[id], `${id} is missing`);
    assert.equal(layers[id].source, 'basemap', id);
    assert.equal(layers[id]['source-layer'], 'railways', id);
  }
  const cases = [
    [{type: 2, properties: {kind: 'rail'}}, ['rail-casing', 'rail-ties']],
    [{type: 2, properties: {kind: 'disused_rail'}}, ['disused-rail']],
    [{type: 3, properties: {kind: 'platform'}}, ['platform-areas']],
    [{type: 2, properties: {kind: 'platform'}}, ['platform-lines']],
    [{type: 1, properties: {kind: 'station'}}, ['railway-stations']],
    [{type: 1, properties: {kind: 'halt'}}, ['railway-halts']],
    [{type: 3, properties: {kind: 'rail'}}, []]
  ];
  for (const [feature, expected] of cases) {
    assert.deepEqual(railwayLayersFor(layers, feature), expected, JSON.stringify(feature));
  }
});

test('rail ties are lighter dashes over a widening casing, and disused track is fainter', () => {
  const layers = railwayLayers();
  const casing = layers['rail-casing'].paint;
  const ties = layers['rail-ties'].paint;
  assert.equal(casing['line-color'], basemapColors.railwayTrack);
  assert.equal(ties['line-color'], basemapColors.railwayTie);
  assert.ok(ties['line-dasharray']?.length > 0, 'ties need a dash pattern');
  // Interpolation stops are zoom, width pairs; a flat width would break the widening track.
  const casingWidths = casing['line-width'].slice(4).filter((_value, index) => index % 2 === 1);
  assert.deepEqual(casingWidths, [...casingWidths].sort((left, right) => left - right));
  assert.ok(casingWidths.at(-1) > casingWidths[0]);
  assert.equal(layers['disused-rail'].paint['line-color'], basemapColors.railwayTrack);
  assert.ok(layers['disused-rail'].paint['line-opacity'] < 1);
  assert.ok(layers['disused-rail'].paint['line-dasharray']?.length > 0);
  assert.equal(layers['platform-areas'].paint['fill-color'], basemapColors.railwayPlatform);
});

test('railways sit above land and bridge decks but below roads', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const trackPositions = railwayTrackLayerIds.map(positionOf);
  const labelPositions = railwayLabelLayerIds.map(positionOf);
  const below = ['land', 'meadows', 'bridge-decks', 'bridge-deck-edges'].map(positionOf);
  const above = ['road-casing', 'minor-casing', 'minor-roads', 'major-roads', 'steps'].map(positionOf);
  assert.ok([...trackPositions, ...labelPositions].every(position => position >= 0));
  assert.ok(Math.max(...below) < Math.min(...trackPositions), 'railways must cover land and bridge decks');
  assert.ok(Math.max(...trackPositions) < Math.min(...above), 'roads must cover railways');
  assert.ok(Math.max(...above) < Math.min(...labelPositions), 'station names stay above roads');
  assert.ok(drawingGroups.indexOf('meadows') < drawingGroups.indexOf('railways'));
  assert.ok(drawingGroups.indexOf('railways') < drawingGroups.indexOf('streets'));
  for (const id of railwayLabelLayerIds) {
    assert.equal(style.layers.find(layer => layer.id === id).metadata[drawingGroupKey], 'labels');
  }
});
