import test from 'node:test';
import assert from 'node:assert/strict';
import {
  foldForSearch,
  formatCoordinates,
  formatDistance,
  matchesSearch,
  nearestPlaces,
  safeWebsite
} from '../src/core.js';

const place = (name, category, coordinates) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {name, category}
});

test('search handles Serbian Latin diacritics and Cyrillic', () => {
  assert.equal(foldForSearch('Његошева улица'), 'njegoseva ulica');
  assert.equal(foldForSearch('Đorđević'), 'djordjevic');
  assert.equal(matchesSearch(place('Никшић', 'sights', [19, 42]), 'niksic', 'all'), true);
});

test('category filter and nearest ordering operate independently', () => {
  const cafe = place('Cafe', 'food', [19.25, 42.44]);
  const museum = place('Museum', 'sights', [18.8, 42.4]);
  assert.equal(matchesSearch(cafe, 'cafe', 'shops'), false);
  const [nearest] = nearestPlaces([museum, cafe], [19.25, 42.44]);
  assert.equal(nearest.place, cafe);
  assert.equal(nearest.distanceKilometres, 0);
});

test('place URLs reject executable and malformed schemes', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'not a URL']) {
    assert.equal(safeWebsite(value), null, value);
  }
  assert.equal(safeWebsite('https://example.org'), 'https://example.org/');
});

test('distances read in whole metres below a kilometre, then in kilometres', () => {
  assert.equal(formatDistance(0), '0 m');
  assert.equal(formatDistance(999.4), '999 m');
  assert.equal(formatDistance(1000), '1.0 km');
  assert.equal(formatDistance(12345), '12.3 km');
});

test('coordinates read latitude first, to five decimals', () => {
  assert.equal(formatCoordinates([19.2593641, 42.4411]), '42.44110, 19.25936');
});
