import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {
  parseVisibilityConfig,
  normalizePlaces,
  placeVisibilityLevel,
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
// Distinct values let a test tell an exact kind rule (2) from a category default (3 or 5) and the fallback (4).
const policy = {fallbackLevel: 4, kinds: {memorial: 2}, categories: {food: 5, sights: 3}};
const policyConfig = parseVisibilityConfig(rawConfig, policy);
const place = (entityId, visibilityLevel, coordinates = [19.26, 42.44], extra = {}) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {entityId, name: entityId, kind: 'bakery', visibilityLevel, ...extra}
});
const placeWithoutLevel = (entityId, kind, extra = {}) => {
  const feature = place(entityId, undefined, [19.26, 42.44], {kind, ...extra});
  delete feature.properties.visibilityLevel;
  return feature;
};

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
  assert.throws(() => parseVisibilityConfig(rawConfig, {}), /policy fallback/);
  assert.throws(() => parseVisibilityConfig(rawConfig, {fallbackLevel: 9}), /policy fallback/);
  assert.throws(() => parseVisibilityConfig(rawConfig, {fallbackLevel: 1}), /policy fallback/);
  assert.throws(() => parseVisibilityConfig(rawConfig, {fallbackLevel: {toString: null}}), /policy fallback/);
});

test('a missing level normalizes to the fallback; an invalid one fails visibly', () => {
  const missing = place('node/a', 5);
  delete missing.properties.visibilityLevel;
  assert.equal(normalizePlaces([missing], config)[0].properties.visibilityLevel, 5);
  for (const bad of [0, 6, 1.5, '2', false, null])
    assert.throws(() => normalizePlaces([place('node/a', bad)], config), /invalid visibilityLevel/);
  assert.throws(() => assertPublishedPlaces([missing], config), /needs a valid/);
});

test('an override without a stored level wins over every default', () => {
  const feature = placeWithoutLevel('node/override', 'memorial', {visibilityOverride: 5});
  assert.equal(Object.hasOwn(feature.properties, 'visibilityLevel'), false);
  assert.equal(placeVisibilityLevel(feature, policyConfig), 5);
  assert.equal(normalizePlaces([feature], policyConfig)[0].properties.visibilityLevel, 5);
});

test('a version-3 POI keeps its stored visibilityLevel', () => {
  // The released snapshot stores `id`, a category and an assigned level. None of the policy defaults may replace it.
  const feature = place('node/308749213', 5, [19.26, 42.44], {
    id: 'node/308749213',
    category: 'sights',
    kind: 'museum'
  });
  delete feature.properties.entityId;
  assert.equal(placeVisibilityLevel(feature, policyConfig), 5);
});

test('an exact kind rule wins over its category default and the fallback', () => {
  assert.equal(placeVisibilityLevel(placeWithoutLevel('node/memorial', 'memorial'), policyConfig), 2);
});

test('normalizePlaces uses the policy for a POI with no stored level', () => {
  // `museum` has no exact rule here: only the policy's sights category can produce 3.
  const feature = placeWithoutLevel('node/museum', 'museum');
  assert.equal(normalizePlaces([feature], policyConfig)[0].properties.visibilityLevel, 3);
});

test('a kind without its own rule uses its category from the kind vocabulary', () => {
  // The stored category is deliberately wrong: version 5 drops it, so the resolver asks placeCategory instead.
  const feature = placeWithoutLevel('node/cafe', 'cafe', {category: 'stay'});
  assert.equal(placeVisibilityLevel(feature, policyConfig), 5);
});

test('the fallback comes from the supplied policy, or the contract when none is supplied', () => {
  const feature = placeWithoutLevel('node/unknown', 'unmapped_kind', {category: 'sights'});
  assert.equal(placeVisibilityLevel(feature, config), 5);
  assert.equal(placeVisibilityLevel(feature, policyConfig), 4);
  assert.equal(normalizePlaces([feature], policyConfig)[0].properties.visibilityLevel, 4);
});

test('an invalid override names the POI and the value it came from', () => {
  const feature = placeWithoutLevel('node/legacy-override', 'museum');
  delete feature.properties.entityId;
  feature.properties.id = 'node/legacy-override';
  feature.properties.visibilityOverride = 6;
  feature.properties.visibilityLevel = 2;
  assert.throws(
    () => placeVisibilityLevel(feature, policyConfig),
    /Place node\/legacy-override: invalid visibilityOverride 6/
  );
});

test('an invalid level without toString still names the POI and its field', () => {
  for (const field of ['visibilityOverride', 'visibilityLevel']) {
    const feature = placeWithoutLevel('node/unstringifiable', 'memorial');
    feature.properties[field] = {toString: null};
    const expected = `Place node/unstringifiable: invalid ${field} {"toString":null}`;
    assert.throws(() => placeVisibilityLevel(feature, policyConfig), error => error.message === expected);
  }
});

test('unsupported policy defaults are rejected before any POI is read', () => {
  assert.throws(
    () => parseVisibilityConfig(rawConfig, {fallbackLevel: 4, kinds: []}),
    /kind defaults must be an object/
  );
  assert.throws(
    () => parseVisibilityConfig(rawConfig, {fallbackLevel: 4, kinds: {memorial: 1}}),
    /kind memorial: invalid default level 1/
  );
  assert.throws(
    () => parseVisibilityConfig(rawConfig, {fallbackLevel: 4, categories: {food: 9}}),
    /category food: invalid default level 9/
  );
});

test('mutating a supplied policy after parsing cannot bypass validation', () => {
  const mutablePolicy = {fallbackLevel: 4, kinds: {memorial: 2}, categories: {food: 5}};
  const mutableConfig = parseVisibilityConfig(rawConfig, mutablePolicy);
  mutablePolicy.kinds.memorial = 1;
  mutablePolicy.categories.food = 6;
  mutablePolicy.fallbackLevel = 1;
  assert.equal(placeVisibilityLevel(placeWithoutLevel('node/mutated-kind', 'memorial'), mutableConfig), 2);
  assert.equal(placeVisibilityLevel(placeWithoutLevel('node/mutated-category', 'cafe'), mutableConfig), 5);
  assert.equal(placeVisibilityLevel(placeWithoutLevel('node/mutated-fallback', 'unmapped_kind'), mutableConfig), 4);
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
    {entityId: 'node/restaurant', name: 'Restaurant', kind: 'restaurant', category: 'food', icon: 'place-food'},
    {entityId: 'node/museum', name: 'Museum', kind: 'museum', category: 'sights', icon: 'place-sights'},
    {entityId: 'node/bakery', name: 'Bakery', kind: 'bakery', category: 'shops', icon: 'place-shops'},
    {entityId: 'node/hotel', name: 'Hotel', kind: 'hotel', category: 'stay', icon: 'place-stay'},
    {entityId: 'node/atm', name: 'ATM', kind: 'atm', category: 'essentials', icon: 'place-essentials'},
    {entityId: 'node/unclassified', name: 'Unknown', kind: 'unmapped_kind', category: 'other', icon: 'place-other'}
  ];
  // A released 0.1.0 POI has only `id`; its kind and stored category agree, so it keeps today's icon and identity.
  const releasedIdOnly = {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [19.2 + cases.length / 100, 42.4]},
    properties: {
      id: 'node/308749213',
      name: 'Euro Petrol',
      kind: 'fuel',
      category: 'essentials',
      visibilityLevel: 5
    }
  };
  const directory = [
    ...cases.map(({entityId, name, kind, category}, index) =>
      place(entityId, 2, [19.2 + index / 100, 42.4], {name, kind, category})
    ),
    releasedIdOnly
  ];
  const markers = buildPlaceMarkers(directory, markerKeys(directory));
  const lookOf = identity => {
    const marker = markers.find(candidate => candidate.properties.markerKey === identity);
    return [marker.properties.category, marker.properties.icon];
  };
  assert.deepEqual(
    cases.map(({entityId}) => lookOf(entityId)),
    cases.map(({category, icon}) => [category, icon])
  );
  const legacyMarker = markers.find(marker => marker.properties.markerKey === releasedIdOnly.properties.id);
  assert.deepEqual(
    [legacyMarker.properties.category, legacyMarker.properties.icon, legacyMarker.properties.activeIds],
    ['essentials', 'place-essentials', '["node/308749213"]']
  );
});

test('ambiguous kinds follow the kind table without a stored override', () => {
  // The five POIs whose stored category disagrees with their kind in the editor's 0.2.0 pin. The #517 decision moves
  // them to the kind's category, so their icons change as agreed.
  const cases = [
    ['node/4222066492', 'EKO', 'fuel', 'shops', 'essentials', 'place-essentials'],
    ['node/4222113290', 'EKO', 'fuel', 'shops', 'essentials', 'place-essentials'],
    ['way/383768698', 'Petrol', 'fuel', 'shops', 'essentials', 'place-essentials'],
    ['way/303138707', 'Palača Smekja', 'hotel', 'sights', 'stay', 'place-stay'],
    ['way/1464599145', 'Kampana Tower', 'yes', 'sights', 'shops', 'place-shops']
  ];
  const directory = cases.map(([entityId, name, kind, category], index) =>
    place(entityId, 2, [19.3 + index / 100, 42.43], {name, kind, category})
  );
  const markers = buildPlaceMarkers(directory, markerKeys(directory));
  const lookOf = entityId => {
    const marker = markers.find(candidate => candidate.properties.markerKey === entityId);
    return [marker.properties.category, marker.properties.icon];
  };
  assert.deepEqual(
    cases.map(([entityId]) => lookOf(entityId)),
    cases.map(([_entityId, _name, _kind, _category, expectedCategory, expectedIcon]) => [expectedCategory, expectedIcon])
  );
});
