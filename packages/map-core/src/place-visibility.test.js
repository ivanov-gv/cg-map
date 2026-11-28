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
} from './place-visibility.js';

const rawConfig = JSON.parse(
  fs.readFileSync(new URL(import.meta.resolve('@ivanov-gv/map-contracts/place-visibility.json')))
);
const config = parseVisibilityConfig(rawConfig);
const place = (entityId, visibilityLevel, coordinates = [19.26, 42.44], extra = {}) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {entityId, name: entityId, kind: 'bakery', visibilityLevel, ...extra}
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

test('at every threshold, a level is absent just below it and present at it and above', () => {
  const {icons} = placeLayers(placeBands([], config), config);
  const levelsDrawnAt = zoom =>
    icons
      .filter(layer => layer.minzoom <= zoom)
      .map(layer => Number(layer.id.match(/-(\d)-open$/)[1]))
      .sort();
  for (const {level, minZoom} of rawConfig.levels) {
    const levelsUpTo = rawConfig.levels.filter(rule => rule.level <= level).map(rule => rule.level);
    assert.deepEqual(levelsDrawnAt(minZoom - 0.01), levelsUpTo.slice(0, -1));
    assert.deepEqual(levelsDrawnAt(minZoom), levelsUpTo);
    assert.deepEqual(levelsDrawnAt(minZoom + 0.01), levelsUpTo);
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
  const missing = place('node/a', 5);
  delete missing.properties.visibilityLevel;
  assert.equal(normalizePlaces([missing], config)[0].properties.visibilityLevel, 5);
  for (const bad of [0, 6, 1.5, '2', false, null])
    assert.throws(() => normalizePlaces([place('node/a', bad)], config), /invalid visibilityLevel/);
  assert.throws(() => assertPublishedPlaces([missing], config), /needs a valid/);
});

test('released POIs use their id until data publishes entityId', () => {
  const legacy = place('node/a', 2);
  legacy.properties.id = legacy.properties.entityId;
  delete legacy.properties.entityId;
  assert.equal(normalizePlaces([legacy], config)[0].properties.visibilityLevel, 2);
  assert.doesNotThrow(() => assertPublishedPlaces([legacy], config));
  assert.equal(markerKeys([legacy]).get('node/a'), 'node/a');
  const marker = buildPlaceMarkers([legacy], markerKeys([legacy]))[0];
  assert.equal(marker.properties.markerKey, 'node/a');
  assert.deepEqual(JSON.parse(marker.properties.activeIds), ['node/a']);
  delete legacy.properties.id;
  assert.throws(() => normalizePlaces([legacy], config), /missing entity identity/);
});

test('code-point order is not UTF-16 unit order', () => {
  assert.ok(compareCodePoints('\u{1F600}', '￿') > 0);
  assert.ok(compareCodePoints('a', 'ab') < 0);
  assert.equal(compareCodePoints('a', 'a'), 0);
});

test('shared marker identity ignores filters and levels; members grow only at thresholds', () => {
  const directory = [
    place('node/z', 5),
    place('node/a', 2),
    place('node/m', 4),
    place('node/alone', 3, [19.3, 42.5])
  ];
  const keys = markerKeys(directory);
  assert.equal(keys.get('node/alone'), 'node/alone');
  assert.equal(keys.get('node/z'), keys.get('node/a'));
  assert.equal(markerKeys([...directory].reverse()).get('node/a'), keys.get('node/a'));
  const markers = buildPlaceMarkers(directory, keys).filter(marker => marker.properties.markerKey === keys.get('node/a'));
  assert.deepEqual(
    markers.map(marker => [marker.properties.band, marker.properties.count, marker.properties.activeIds]),
    [
      ['2-4', '', '["node/a"]'],
      ['4-5', '2', '["node/a","node/m"]'],
      ['5-open', '3', '["node/a","node/m","node/z"]']
    ]
  );
  assert.deepEqual(
    markers.map(marker => marker.properties.first),
    [true, false, false]
  );
  const filtered = buildPlaceMarkers([directory[0]], keys);
  assert.equal(filtered[0].properties.markerKey, keys.get('node/z'));
  assert.equal(filtered[0].properties.icon, 'place-shops');
});

test('marker order is independent of input order', () => {
  const directory = [
    place('node/b', 4),
    place('node/a', 4, [19.1, 42.1]),
    place('node/c', 2, [19.2, 42.2])
  ];
  const summary = features =>
    buildPlaceMarkers(features, markerKeys(features)).map(marker => [
      marker.properties.markerKey,
      marker.properties.rank
    ]);
  assert.deepEqual(summary(directory), [
    ['node/c', 0],
    ['node/a', 1],
    ['node/b', 2]
  ]);
  assert.deepEqual(summary([...directory].reverse()), summary(directory));
});

test('entityId wins over a conflicting legacy id', () => {
  const canonical = place('node/first', 2, [19.4, 42.4]);
  canonical.properties.id = 'node/legacy-first';
  const duplicate = place('node/second', 2, [19.4, 42.4]);
  duplicate.properties.id = 'node/first';
  const directory = [canonical, duplicate];
  const keys = markerKeys(directory);
  assert.equal(keys.get('node/first'), 'shared:["node/first","node/second"]');
  assert.equal(keys.get('node/legacy-first'), undefined);
  const marker = buildPlaceMarkers(directory, keys)[0];
  assert.deepEqual(JSON.parse(marker.properties.activeIds), ['node/first', 'node/second']);
});

test('an override changes only its own threshold band', () => {
  const base = [place('node/a', 4, [19.1, 42.1]), place('node/b', 5, [19.2, 42.2])],
    promoted = [place('node/a', 2, [19.1, 42.1]), base[1]];
  const bands = features =>
    Object.fromEntries(
      buildPlaceMarkers(features, markerKeys(features)).map(marker => [
        marker.properties.markerKey,
        marker.properties.band
      ])
    );
  assert.deepEqual(bands(base), {'node/a': '4-open', 'node/b': '5-open'});
  assert.deepEqual(bands(promoted), {'node/a': '2-open', 'node/b': '5-open'});
});

test('the requested listing hands over to the ordinary marker at its threshold', () => {
  const directory = [
      place('node/low', 5),
      place('node/high', 2),
      place('node/other', 4, [19.3, 42.5])
    ],
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
  const directory = [place('node/a', 2), place('node/b', 5), place('node/c', 3, [19.3, 42.5])];
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
  const firstPlace = place('node/a', 4),
    secondPlace = place('node/b', 2),
    byEntityId = new Map([
      ['node/a', firstPlace],
      ['node/b', secondPlace]
    ]);
  const hits = [
    {properties: {activeIds: '["node/a","node/b"]'}},
    {properties: {activeIds: '["node/b"]'}},
    {properties: {}}
  ];
  assert.deepEqual(
    listingsAtHits(hits, byEntityId).map(listing => listing.properties.entityId),
    ['node/b', 'node/a']
  );
});

test('POI symbols come from kind, with table cases for every category', () => {
  const cases = [
    ['node/restaurant', 'restaurant', 'food', 'place-food'],
    ['node/museum', 'museum', 'sights', 'place-sights'],
    ['node/bakery', 'bakery', 'shops', 'place-shops'],
    ['node/hotel', 'hotel', 'stay', 'place-stay'],
    ['node/atm', 'atm', 'essentials', 'place-essentials'],
    ['node/unclassified', 'unmapped_kind', 'other', 'place-other']
  ];
  const directory = cases.map(([entityId, kind], index) =>
    place(entityId, 2, [19.2 + index / 100, 42.4], {kind})
  );
  const markers = buildPlaceMarkers(directory, markerKeys(directory));
  const lookOf = entityId => {
    const marker = markers.find(candidate => candidate.properties.markerKey === entityId);
    return [marker.properties.category, marker.properties.icon];
  };
  assert.deepEqual(
    cases.map(([entityId, _kind]) => lookOf(entityId)),
    cases.map(([_entityId, _kind, category, icon]) => [category, icon])
  );
});

test('ambiguous kinds keep today\'s category until data chooses one', () => {
  const asShop = place('node/fuel-shop', 2, [19.31, 42.43], {kind: 'fuel', category: 'shops'});
  const withoutCategory = place('node/fuel', 2, [19.32, 42.44], {kind: 'fuel'});
  const directory = [asShop, withoutCategory];
  const markers = buildPlaceMarkers(directory, markerKeys(directory));
  const lookOf = entityId => {
    const marker = markers.find(candidate => candidate.properties.markerKey === entityId);
    return [marker.properties.category, marker.properties.icon];
  };
  assert.deepEqual(lookOf('node/fuel-shop'), ['shops', 'place-shops']);
  assert.deepEqual(lookOf('node/fuel'), ['essentials', 'place-essentials']);
});

test("today's released POI values keep their symbols and identity", () => {
  // This compatibility check is expected to pass against the old rules too; it pins the look we must not change.
  // The 0.1.0 pin used by web and core-demo carries `id` and no `entityId`; editor's 0.2.0 pin has `entityId`.
  const released = [
    {id: 'node/1', kind: 'cafe', category: 'food', visibilityLevel: 2},
    {id: 'node/2', kind: 'museum', category: 'sights', visibilityLevel: 3},
    {id: 'node/3', kind: 'fuel', category: 'essentials', visibilityLevel: 4}
  ];
  const directory = released.map((properties, index) =>
    place(properties.id, properties.visibilityLevel, [19.1 + index / 100, 42.5], {
      kind: properties.kind,
      category: properties.category,
      id: properties.id
    })
  );
  for (const feature of directory) delete feature.properties.entityId;
  const keys = markerKeys(directory);
  const markers = buildPlaceMarkers(directory, keys);
  assert.deepEqual([...keys.keys()], ['node/1', 'node/2', 'node/3']);
  assert.deepEqual(
    markers.map(marker => [marker.properties.category, marker.properties.icon]),
    [
      ['food', 'place-food'],
      ['sights', 'place-sights'],
      ['essentials', 'place-essentials']
    ]
  );
  assert.deepEqual(
    markers.map(marker => JSON.parse(marker.properties.activeIds)),
    [['node/1'], ['node/2'], ['node/3']]
  );
});
