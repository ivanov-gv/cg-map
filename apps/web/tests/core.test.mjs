import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText,
  matchesPlaceSearch,
  selectNearestPlaces,
  safeWebsite,
  isUserCameraEvent
} from '../src/core.js';
const feature = (name, category, coordinates) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates},
  properties: {name, category}
});
test('search handles Serbian Latin diacritics and Cyrillic', () => {
  assert.equal(normalizeSearchText('Његошева улица'), 'njegoseva ulica');
  assert.equal(normalizeSearchText('Đorđević'), 'djordjevic');
  assert.equal(matchesPlaceSearch(feature('Никшић', 'sights', [19, 42]), 'niksic', 'all'), true);
});
test('category filter and nearest ordering operate independently', () => {
  const cafe = feature('Cafe', 'food', [19.25, 42.44]);
  const museum = feature('Museum', 'sights', [18.8, 42.4]);
  assert.equal(matchesPlaceSearch(cafe, 'cafe', 'shops'), false);
  assert.equal(selectNearestPlaces([museum, cafe], [19.25, 42.44])[0].feature, cafe);
});
test('place URLs reject executable and malformed schemes', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/x', 'not a URL'])
    assert.equal(safeWebsite(value), null);
  assert.equal(safeWebsite('https://example.org'), 'https://example.org/');
});
test('isUserCameraEvent returns true when originalEvent is present', () => {
  assert.equal(isUserCameraEvent({originalEvent: {type: 'mousedown'}}), true);
});
test('isUserCameraEvent returns false when originalEvent is missing', () => {
  assert.equal(isUserCameraEvent({}), false);
});
test('isUserCameraEvent returns false for undefined originalEvent', () => {
  assert.equal(isUserCameraEvent({originalEvent: undefined}), false);
});
test('isUserCameraEvent handles touch and wheel original events', () => {
  assert.equal(isUserCameraEvent({originalEvent: {type: 'touchstart'}}), true);
  assert.equal(isUserCameraEvent({originalEvent: {type: 'wheel'}}), true);
});
