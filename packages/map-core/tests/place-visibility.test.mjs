import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {
  parseVisibilityConfig,
  normalizePlaces,
  assertPublishedPlaces,
  compareCodePoints,
  markerKeys,
  placeBands,
  buildPlaceMarkers,
  requestedPlaceMarker,
  placeLayers,
  listingsAtHits
} from '../src/place-visibility.js';

const rawConfig = JSON.parse(fs.readFileSync(new URL('../../contracts/place-visibility.json', import.meta.url)));
const config = parseVisibilityConfig(rawConfig);
const place = (id, visibilityLevel, coordinates = [19.26, 42.44], extra = {}) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {id, name: id, category: 'shops', visibilityLevel, ...extra}
});

test('published levels are consecutive, cumulative, and inclusive at each threshold', () => {
  assert.deepEqual(
    rawConfig.levels.map(levelRule => [levelRule.level, levelRule.minZoom]),
    [
      [1, 12],
      [2, 14],
      [3, 15],
      [4, 16],
      [5, 17]
    ]
  );
  // Layer minzoom is inclusive and an open band has no upper limit; the browser suite proves it at fractional zooms.
  const {icons, names} = placeLayers(placeBands([], config), config);
  for (const {level, minZoom} of rawConfig.levels)
    for (const layer of [icons, names].map(list => list.find(candidate => candidate.id.endsWith(`-${level}-open`)))) {
      assert.equal(layer.minzoom, minZoom);
      assert.equal(layer.maxzoom, undefined);
    }
});

test('ordinary businesses never appear at country or region scale', () => {
  assert.ok(Math.min(...config.thresholds.values()) >= 12);
});

test('malformed configurations are rejected', () => {
  for (const levels of [
    [],
    [{level: 2, minZoom: 12}],
    [
      {level: 1, minZoom: 12},
      {level: 2, minZoom: 12}
    ]
  ]) {
    assert.throws(() => parseVisibilityConfig({version: 1, legacyFallbackLevel: 1, levels}));
  }
  assert.throws(() => parseVisibilityConfig({...rawConfig, version: 2}));
  assert.throws(() => parseVisibilityConfig({...rawConfig, legacyFallbackLevel: 9}), /fallback/);
  assert.throws(() => parseVisibilityConfig({...rawConfig, legacyFallbackLevel: 1}), /fallback/);
});

test('a missing level normalizes to the fallback; an invalid one fails visibly', () => {
  const missing = place('a');
  delete missing.properties.visibilityLevel;
  assert.equal(normalizePlaces([missing], config)[0].properties.visibilityLevel, 5);
  for (const bad of [0, 6, 1.5, '2', false, null])
    assert.throws(() => normalizePlaces([place('a', bad)], config), /invalid visibilityLevel/);
  assert.throws(() => assertPublishedPlaces([missing], config), /needs a valid/);
});

test('code-point order is not UTF-16 unit order', () => {
  assert.ok(compareCodePoints('\u{1F600}', '￿') > 0);
  assert.ok(compareCodePoints('a', 'ab') < 0);
  assert.equal(compareCodePoints('a', 'a'), 0);
});

test('shared marker identity ignores filters and levels; members grow only at thresholds', () => {
  const directory = [place('z', 5), place('a', 2), place('m', 4), place('alone', 3, [19.3, 42.5])];
  const keys = markerKeys(directory);
  assert.equal(keys.get('alone'), 'alone');
  assert.equal(keys.get('z'), keys.get('a'));
  assert.equal(markerKeys([...directory].reverse()).get('a'), keys.get('a'));
  const markers = buildPlaceMarkers(directory, keys).filter(marker => marker.properties.markerKey === keys.get('a'));
  assert.deepEqual(
    markers.map(marker => [marker.properties.band, marker.properties.count, marker.properties.activeIds]),
    [
      ['2-4', '', '["a"]'],
      ['4-5', '2', '["a","m"]'],
      ['5-open', '3', '["a","m","z"]']
    ]
  );
  assert.deepEqual(
    markers.map(marker => marker.properties.first),
    [true, false, false]
  );
  const filtered = buildPlaceMarkers([directory[0]], keys);
  assert.equal(filtered[0].properties.markerKey, keys.get('a'));
  assert.equal(filtered[0].properties.icon, 'place-shops');
});

test('marker order is independent of input order', () => {
  const directory = [place('b', 4), place('a', 4, [19.1, 42.1]), place('c', 2, [19.2, 42.2])];
  const summary = features =>
    buildPlaceMarkers(features, markerKeys(features)).map(marker => [
      marker.properties.markerKey,
      marker.properties.rank
    ]);
  assert.deepEqual(summary(directory), [
    ['c', 0],
    ['a', 1],
    ['b', 2]
  ]);
  assert.deepEqual(summary([...directory].reverse()), summary(directory));
});

test('an override changes only its own threshold band', () => {
  const base = [place('a', 4, [19.1, 42.1]), place('b', 5, [19.2, 42.2])],
    promoted = [place('a', 2, [19.1, 42.1]), base[1]];
  const bands = features =>
    Object.fromEntries(
      buildPlaceMarkers(features, markerKeys(features)).map(marker => [
        marker.properties.markerKey,
        marker.properties.band
      ])
    );
  assert.deepEqual(bands(base), {a: '4-open', b: '5-open'});
  assert.deepEqual(bands(promoted), {a: '2-open', b: '5-open'});
});

test('the requested listing hands over to the ordinary marker at its threshold', () => {
  const directory = [place('low', 5), place('high', 2), place('other', 4, [19.3, 42.5])],
    keys = markerKeys(directory);
  assert.deepEqual(requestedPlaceMarker(null, directory, keys, config).features, []);
  const alone = requestedPlaceMarker(directory[2], directory, keys, config);
  assert.equal(alone.maxzoom, 16);
  assert.deepEqual(alone.features[0].geometry.coordinates, [19.3, 42.5]);
  assert.equal(
    requestedPlaceMarker(directory[0], directory, keys, config).maxzoom,
    14,
    'an admitted marker at the same point takes over'
  );
  assert.equal(
    requestedPlaceMarker(directory[0], [directory[0]], keys, config).maxzoom,
    17,
    'filtered-out members do not'
  );
});

test('generated layers are valid, zoom-gated, and icons ignore collisions', () => {
  const directory = [place('a', 2), place('b', 5), place('c', 3, [19.3, 42.5])];
  const bands = placeBands(directory, config);
  assert.deepEqual(
    bands.filter(band => band.end).map(band => band.id),
    ['2-5']
  );
  assert.equal(bands.at(-1).start, 1);
  const {names, icons} = placeLayers(bands, config);
  const style = {
    version: 8,
    glyphs: 'https://example.test/{fontstack}/{range}.pbf',
    sources: {places: {type: 'geojson', data: {type: 'FeatureCollection', features: []}}},
    layers: [...names, ...icons]
  };
  assert.deepEqual(
    validateStyleMin(style).map(error => error.message),
    []
  );
  for (const layer of icons) {
    assert.equal(layer.layout['icon-allow-overlap'], true);
    assert.equal(layer.layout['icon-ignore-placement'], true);
    assert.equal(layer.layout['text-allow-overlap'], true);
  }
  for (const layer of names) {
    assert.equal(layer.layout['icon-image'], undefined);
    assert.equal(layer.layout['text-allow-overlap'], undefined);
  }
  const closed = icons.find(layer => layer.id === 'place-icons-2-5');
  assert.deepEqual([closed.minzoom, closed.maxzoom], [14, 17]);
  assert.equal(icons.find(layer => layer.id === 'place-icons-5-open').maxzoom, undefined);
});

test('tap hits expand to each listing once in a stable order', () => {
  const firstPlace = place('a', 4),
    secondPlace = place('b', 2),
    byId = new Map([
      ['a', firstPlace],
      ['b', secondPlace]
    ]);
  const hits = [{properties: {activeIds: '["a","b"]'}}, {properties: {activeIds: '["b"]'}}, {properties: {}}];
  assert.deepEqual(
    listingsAtHits(hits, byId).map(listing => listing.properties.id),
    ['b', 'a']
  );
});
