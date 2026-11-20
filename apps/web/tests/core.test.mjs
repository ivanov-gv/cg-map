import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText,
  matchesPlaceSearch,
  classifyBuildingMatch,
  buildingResultLabel,
  selectNearestPlaces,
  selectSearchResults,
  safeWebsite
} from '../src/core.js';
const feature = (name, category, coordinates) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {name, category}
});
test('search handles Serbian Latin diacritics and Cyrillic', () => {
  assert.equal(normalizeSearchText('Његошева улица'), 'njegoseva ulica');
  assert.equal(normalizeSearchText('Đorđević'), 'djordjevic');
  assert.equal(matchesPlaceSearch(feature('Никшић', 'sights', [19, 42]), 'niksic', null), true);
});
test('null category matches every category', () => {
  const cafe = feature('Cafe', 'food', [19.25, 42.44]);
  const museum = feature('Museum', 'sights', [18.8, 42.4]);
  assert.equal(matchesPlaceSearch(cafe, 'cafe', null), true);
  assert.equal(matchesPlaceSearch(museum, 'museum', null), true);
});
test('category filter and nearest ordering operate independently', () => {
  const cafe = feature('Cafe', 'food', [19.25, 42.44]);
  const museum = feature('Museum', 'sights', [18.8, 42.4]);
  assert.equal(matchesPlaceSearch(cafe, 'cafe', 'shops'), false);
  assert.equal(selectNearestPlaces([museum, cafe], [19.25, 42.44])[0].feature, cafe);
});
test('selectNearestPlaces orders by distance from centre', () => {
  const near = feature('Near', 'food', [19.26, 42.44]);
  const far = feature('Far', 'food', [19.5, 42.5]);
  const middle = feature('Middle', 'food', [19.35, 42.47]);
  const center = [19.26, 42.44];
  const ordered = selectNearestPlaces([far, middle, near], center);
  assert.equal(ordered[0].feature.properties.name, 'Near');
  assert.equal(ordered[1].feature.properties.name, 'Middle');
  assert.equal(ordered[2].feature.properties.name, 'Far');
  assert.ok(ordered[0].distanceKilometres < ordered[1].distanceKilometres);
  assert.ok(ordered[1].distanceKilometres < ordered[2].distanceKilometres);
});
test('category and query filters both apply', () => {
  const cafeAlpha = feature('Cafe Alpha', 'food', [19.25, 42.44]);
  const cafeBeta = feature('Cafe Beta', 'food', [19.26, 42.44]);
  const alphaShop = feature('Alpha Shop', 'shops', [19.27, 42.44]);
  // Query 'alpha' with category 'food': only Cafe Alpha matches both
  const filtered = [cafeAlpha, cafeBeta, alphaShop].filter(place =>
    matchesPlaceSearch(place, 'alpha', 'food')
  );
  assert.equal(filtered.length, 1, 'only Cafe Alpha matches category food and query "alpha"');
  assert.ok(filtered.some(place => place === cafeAlpha));
  // Cafe Beta is excluded by query; Alpha Shop is excluded by category
  assert.equal(filtered.includes(cafeBeta), false);
  assert.equal(filtered.includes(alphaShop), false);
});
test('no category filter includes all categories', () => {
  const cafe = feature('Cafe', 'food', [19.25, 42.44]);
  const museum = feature('Museum', 'sights', [18.8, 42.4]);
  const shop = feature('Shop', 'shops', [19.3, 42.45]);
  const filtered = [cafe, museum, shop].filter(place =>
    matchesPlaceSearch(place, '', null)
  );
  assert.equal(filtered.length, 3, 'no category and empty query matches all');
});
const addressLabel = (footprintIndex, coordinates, properties = {}) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {
    kind: 'building',
    footprintIndex,
    'addr:housenumber': '18',
    'addr:street': 'Bulevar Stanka Dragojevića',
    ...properties
  }
});

test('building search distinguishes a street address from a building number', () => {
  const label = addressLabel(4, [19.25, 42.44]);
  assert.deepEqual(classifyBuildingMatch(label, 'dragojevica'), {kind: 'address'});
  assert.deepEqual(classifyBuildingMatch(label, '18'), {kind: 'building'});
  assert.deepEqual(classifyBuildingMatch(label, 'Bulevar 18'), {kind: 'address'});
  assert.equal(classifyBuildingMatch(label, 'bulevar 99'), null);
  assert.equal(classifyBuildingMatch(label, ''), null);
});

test('building classification ignores street and number word order', () => {
  const label = addressLabel(4, [19.25, 42.44]);
  assert.deepEqual(classifyBuildingMatch(label, 'Dragojevića 18'), {kind: 'address'});
  assert.deepEqual(classifyBuildingMatch(label, '18 Bulevar Stanka'), {kind: 'address'});
  assert.deepEqual(classifyBuildingMatch(label, '18'), {kind: 'building'});
});

test('building search uses entrance and section identifiers without duplicating a footprint', () => {
  const label = addressLabel(9, [19.25, 42.44], {
    building_number: '12',
    lamela: 'B',
    entrances: [{number: '3', ref: 'M', street: 'Ulica Slobode'}]
  });
  assert.deepEqual(classifyBuildingMatch(label, 'lamela b'), {kind: 'building'});
  assert.deepEqual(classifyBuildingMatch(label, 'ulaz m'), {kind: 'building'});
  assert.deepEqual(classifyBuildingMatch(label, 'Ulica Slobode'), {kind: 'address'});
  // One footprint matches several fields but still yields a single result.
  const results = selectSearchResults({
    places: [],
    buildingLabels: {type: 'FeatureCollection', features: [label]},
    query: '12',
    center: [19.25, 42.44]
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, 'building');
  assert.equal(results[0].label, buildingResultLabel(label.properties));
});

test('search results mix places, buildings and addresses in nearest-first order', () => {
  const far = addressLabel(30, [19.5, 42.5], {'addr:street': 'Bulevar Ivana Crnojevića'});
  const near = addressLabel(4, [19.26, 42.44]);
  const place = {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [19.255, 42.441]},
    properties: {id: 'cafe/1', name: 'Bulevar Cafe', category: 'food'}
  };
  const results = selectSearchResults({
    places: [place],
    buildingLabels: {type: 'FeatureCollection', features: [far, near]},
    query: 'bulevar',
    center: [19.26, 42.44],
    markerKeys: new Map([['cafe/1', 'place-key']])
  });
  assert.deepEqual(
    results.map(result => result.kind),
    ['address', 'place', 'address']
  );
  assert.equal(results[0].footprintIndex, 4);
  assert.equal(results[1].feature, place);
  assert.equal(results[2].footprintIndex, 30);
  assert.ok(results[0].distanceKilometres < results[1].distanceKilometres);
  assert.ok(results[1].distanceKilometres < results[2].distanceKilometres);
});

test('categories list places only and an empty query lists no buildings', () => {
  const label = addressLabel(4, [19.26, 42.44]);
  const cafe = feature('Cafe 18', 'food', [19.26, 42.44]);
  const collection = {type: 'FeatureCollection', features: [label]};
  const byCategory = selectSearchResults({
    places: [cafe],
    buildingLabels: collection,
    query: '18',
    category: 'food',
    center: [19.26, 42.44]
  });
  assert.equal(byCategory.length, 1);
  assert.equal(byCategory[0].kind, 'place');
  const browsing = selectSearchResults({
    places: [cafe],
    buildingLabels: collection,
    query: '',
    center: [19.26, 42.44]
  });
  assert.equal(browsing.length, 1);
  assert.equal(browsing[0].kind, 'place');
});

test('place URLs reject executable and malformed schemes', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'not a URL'])
    assert.equal(safeWebsite(value), null);
  assert.equal(safeWebsite('https://example.org'), 'https://example.org/');
});
