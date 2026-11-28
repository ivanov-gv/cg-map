import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle, basemapColors, drawingGroups, drawingGroupKey, roadLayerIds} from './index.js';

const walkingLayerIds = ['paths', 'footways', 'park-routes', 'cycleways', 'steps'];
const walkingStyle = mapStyle('pmtiles://archive', 'https://local.test/');
const filters = walkingLayerIds.map(id => ({id, filter: featureFilter(walkingStyle.layers.find(layer => layer.id === id).filter)}));

function walkingLayersFor(properties) {
  const feature = {type: 2, properties};
  return filters.filter(({filter}) => filter.filter({zoom: 16}, feature)).map(({id}) => id);
}

// Version 5 stores the walker's class on each path, including tracks. Today's `main` and unclassified fixtures stay
// in this regression test, so reverting the stored-class rule makes the whole test fail.
test('walking patterns come from stored pathClass with legacy fixtures', () => {
  const cases = [
    [{kind: 'footway', pathClass: 'park'}, 'park-routes'],
    [{kind: 'cycleway', pathClass: 'park'}, 'park-routes'],
    [{kind: 'track', pathClass: 'park'}, 'park-routes'],
    [{kind: 'footway', pathClass: 'city'}, 'footways'],
    [{kind: 'path', pathClass: 'city'}, 'footways'],
    [{kind: 'track', pathClass: 'city'}, 'footways'],
    [{kind: 'footway', pathClass: 'trail'}, 'paths'],
    [{kind: 'track', pathClass: 'trail'}, 'paths'],
    [{kind: 'cycleway', pathClass: 'city'}, 'cycleways'],
    [{kind: 'cycleway', pathClass: 'trail'}, 'cycleways'],
    [{kind: 'steps', pathClass: 'trail'}, 'steps'],
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
  assert.deepEqual(
    walkingLayersFor({kind: 'pedestrian', pathClass: 'city'}),
    [],
    'a pedestrian street stays a street'
  );
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

// Data will publish stored shades in their own tile layer. Until then no feature matches, so today's map is unchanged.
test('stored shades use the shaded tone over green areas and below roads', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const shade = style.layers.find(layer => layer.id === 'shades');
  assert.ok(shade, 'shades is missing');
  assert.equal(shade.type, 'fill');
  assert.equal(shade.source, 'basemap');
  assert.equal(shade['source-layer'], 'shades');
  assert.deepEqual(shade.filter, ['==', ['get', 'kind'], 'shade']);
  assert.deepEqual(shade.paint, {'fill-color': basemapColors.shadedSlope, 'fill-antialias': false});
  assert.equal(shade.minzoom, 12);
  assert.equal(shade.metadata[drawingGroupKey], 'shades');
  const matches = featureFilter(shade.filter).filter;
  assert.equal(matches({zoom: 16}, {type: 3, properties: {kind: 'shade'}}), true);
  assert.equal(matches({zoom: 16}, {type: 3, properties: {kind: 'park'}}), false);

  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const shadePosition = positionOf('shades');
  const groundRoadIds = ['road-casing', 'minor-casing', 'minor-roads', 'major-roads', 'paths', 'steps'];
  const groundRoadPositions = groundRoadIds.map(positionOf);
  assert.ok(positionOf('land') < shadePosition, 'shades must cover green areas');
  assert.ok(shadePosition < Math.min(...groundRoadPositions), 'shades must stay below ground roads');
  assert.ok(shadePosition < positionOf('shaded-slopes'), 'shades must not move above the slope tones');
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

// The water fill's polygon filter already includes every water kind, so a stored sea polygon needs no style change.
test('the stored sea polygon passes the water fill filter', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const water = style.layers.find(layer => layer.id === 'water');
  const matches = featureFilter(water.filter).filter;
  assert.equal(matches({zoom: 16}, {type: 3, properties: {kind: 'sea'}}), true);
  assert.equal(matches({zoom: 16}, {type: 3, properties: {kind: 'lake'}}), true, 'the filter is kind-agnostic');
  assert.equal(water.paint['fill-color'], basemapColors.water);
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

test('bridge decks sit above ground roads and water but below roads on bridges', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const deck = positionOf('bridge-decks');
  const edge = positionOf('bridge-deck-edges');
  const belowDeck = ['land', 'canyon-rims', 'water', 'buildings'].map(positionOf);
  const groundRoadIds = [
    'road-casing', 'minor-casing', 'minor-roads', 'pedestrian-streets', 'major-roads',
    'paths', 'footways', 'park-routes', 'cycleways', 'steps'
  ];
  const groundRoads = groundRoadIds.map(positionOf);
  const raisedRoads = groundRoadIds.map(id => positionOf(`${id}-on-bridge`));
  assert.ok(deck >= 0 && edge > deck, `deck ${deck}, edge ${edge}`);
  for (const index of belowDeck) assert.ok(index >= 0 && index < deck, `layer ${index} is not below the deck`);
  for (const index of groundRoads) assert.ok(index >= 0 && index < deck, `ground road ${index} is not below the deck`);
  for (const index of raisedRoads) assert.ok(index > edge, `road on a bridge ${index} is not above the deck`);
  assert.ok(drawingGroups.indexOf('stairways') < drawingGroups.indexOf('bridges'));
  assert.ok(drawingGroups.indexOf('bridges') < drawingGroups.indexOf('bridge-streets'));
});

test('roadLayerIds returns ground and on-bridge layers for the requested road kinds', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const publishedIds = new Set(style.layers.map(layer => layer.id));
  const roadLineIds = style.layers
    .filter(layer => layer.type === 'line' && layer['source-layer'] === 'roads')
    .map(layer => layer.id);
  const groundIds = roadLineIds.filter(id => !id.endsWith('-on-bridge'));
  assert.deepEqual(roadLayerIds(['steps', 'major-roads']), [
    'steps', 'steps-on-bridge', 'major-roads', 'major-roads-on-bridge'
  ]);
  assert.deepEqual([...roadLayerIds(groundIds)].sort(), [...roadLineIds].sort());
  for (const id of roadLayerIds(groundIds)) assert.ok(publishedIds.has(id), `${id} is not published`);
  assert.throws(() => roadLayerIds(['road-labels']), /Unknown road layer: road-labels/);
  assert.throws(() => roadLayerIds(['steps-on-bridge']), /Unknown road layer: steps-on-bridge/);
});

test('a road is placed by its own bridge tag or layer, never by a crossing deck', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const roadLayers = style.layers.filter(layer => layer.type === 'line' && layer['source-layer'] === 'roads');
  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const deck = positionOf('bridge-decks');
  const edge = positionOf('bridge-deck-edges');
  const matchingLayers = properties => roadLayers
    .filter(layer => featureFilter(layer.filter).filter({zoom: 16}, {type: 2, properties}))
    .map(layer => layer.id);
  const groundRoad = matchingLayers({kind: 'primary'});
  assert.ok(groundRoad.length > 0, 'a ground road needs a road layer');
  assert.ok(
    groundRoad.every(id => positionOf(id) < deck),
    `ground roads must stay below the deck: ${groundRoad.join(', ')}`
  );
  for (const properties of [
    {kind: 'primary', bridge: 'yes'},
    {kind: 'primary', bridge: 'viaduct'},
    {kind: 'primary', layer: '1'},
    {kind: 'primary', layer: 2},
    {kind: 'footway', bridge: 'yes', pathClass: 'trail'}
  ]) {
    const onBridge = matchingLayers(properties);
    assert.ok(onBridge.length > 0, `${JSON.stringify(properties)} has no road layer`);
    assert.ok(
      onBridge.every(id => id.endsWith('-on-bridge') && positionOf(id) > edge),
      `${JSON.stringify(properties)} is not above the deck: ${onBridge.join(', ')}`
    );
  }
  for (const properties of [
    {kind: 'primary', bridge: 'no'},
    {kind: 'primary', bridge: 'yes', layer: '-1'},
    {kind: 'primary', layer: '-1', tunnel: 'yes'},
    {kind: 'primary', tunnel: 'yes', layer: '1'},
    {kind: 'primary', tunnel: 'yes', bridge: 'yes', layer: 2}
  ]) {
    const below = matchingLayers(properties);
    assert.ok(below.length > 0, `${JSON.stringify(properties)} has no road layer`);
    assert.ok(
      below.every(id => positionOf(id) < deck),
      `${JSON.stringify(properties)} must stay below the deck: ${below.join(', ')}`
    );
  }
});

test('bridge drawing uses outlines instead of bridge-tagged road strokes', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const bridgeGroup = style.layers
    .filter(layer => layer.metadata?.[drawingGroupKey] === 'bridges')
    .map(layer => layer.id);
  const deckLayers = style.layers.filter(layer => layer['source-layer'] === 'bridges');
  assert.deepEqual(bridgeGroup, ['bridge-decks', 'bridge-deck-edges']);
  assert.deepEqual(deckLayers.map(layer => layer.id), ['bridge-decks', 'bridge-deck-edges']);
  for (const layer of deckLayers) {
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

test('railways stay below ground roads but above land', () => {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const positionOf = id => style.layers.findIndex(layer => layer.id === id);
  const trackPositions = railwayTrackLayerIds.map(positionOf);
  const labelPositions = railwayLabelLayerIds.map(positionOf);
  const landPositions = ['land', 'meadows'].map(positionOf);
  const groundRoadPositions = [
    'road-casing', 'minor-casing', 'minor-roads', 'major-roads', 'steps'
  ].map(positionOf);
  const raisedRoadPositions = [
    'road-casing-on-bridge', 'minor-casing-on-bridge', 'minor-roads-on-bridge',
    'major-roads-on-bridge', 'steps-on-bridge'
  ].map(positionOf);
  const positions = [
    ...landPositions, ...trackPositions, ...groundRoadPositions, ...raisedRoadPositions, ...labelPositions
  ];
  assert.ok(positions.every(position => position >= 0), 'a layer in the drawing chain is missing');
  assert.ok(Math.max(...landPositions) < Math.min(...trackPositions), 'tracks must cover land');
  assert.ok(Math.max(...trackPositions) < Math.min(...groundRoadPositions), 'ground roads must cover tracks');
  assert.ok(Math.max(...raisedRoadPositions) < Math.min(...labelPositions), 'station names stay above roads');
  assert.ok(drawingGroups.indexOf('railways') < drawingGroups.indexOf('streets'));
  assert.ok(drawingGroups.indexOf('bridge-stairways') < drawingGroups.indexOf('labels'));
  assert.ok(
    style.layers
      .filter(layer => layer['source-layer'] === 'railways')
      .every(layer => !layer.id.endsWith('-on-bridge')),
    'railway tiles carry no bridge tag to raise a track'
  );
  for (const id of railwayLabelLayerIds) {
    assert.equal(style.layers.find(layer => layer.id === id).metadata[drawingGroupKey], 'labels');
  }
});
