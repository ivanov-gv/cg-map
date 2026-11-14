import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchText, matchesPlaceSearch, selectNearestPlaces, safeWebsite} from '../src/core.js';
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
test('category filter then query filter combines both', () => {
  const cafeA = feature('Cafe A', 'food', [19.25, 42.44]);
  const cafeB = feature('Cafe B', 'food', [19.26, 42.44]);
  const shop = feature('Cafe Shop', 'shops', [19.27, 42.44]);
  // Category narrows to food; query narrows further to those containing 'a'
  const filtered = [cafeA, cafeB, shop].filter(place =>
    matchesPlaceSearch(place, 'a', 'food')
  );
  assert.equal(filtered.length, 2, 'both cafes match category food and query "a"');
  assert.ok(filtered.some(place => place === cafeA));
  assert.ok(filtered.some(place => place === cafeB));
  // The shop is excluded by category even though name contains 'a'
  assert.equal(filtered.includes(shop), false);
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
test('place URLs reject executable and malformed schemes', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'not a URL'])
    assert.equal(safeWebsite(value), null);
  assert.equal(safeWebsite('https://example.org'), 'https://example.org/');
});
