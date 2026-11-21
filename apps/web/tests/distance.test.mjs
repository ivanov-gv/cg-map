import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core.js';

const centre = [19.2607, 42.4419];
const fixCoordinates = [19.2609, 42.4421];
const result = (name, coordinates) => ({
  kind: 'place',
  id: name,
  coordinates,
  feature: {geometry: {type: 'Point', coordinates}, properties: {id: name, name, category: 'food', kind: 'cafe'}}
});
const feature = (name, coordinates) => ({
  geometry: {type: 'Point', coordinates},
  properties: {id: name, name, category: 'food', kind: 'cafe'}
});

test('only a live or approximate fix supplies a distance origin', () => {
  const fix = {coordinates: [19.2609, 42.4421], accuracy: 18, timestamp: 1000};
  assert.deepEqual(core.distanceOrigin({state: 'live', fix}), [19.2609, 42.4421]);
  assert.deepEqual(core.distanceOrigin({state: 'approximate', fix}), [19.2609, 42.4421]);
  for (const state of [
    'idle',
    'prompt',
    'acquiring',
    'stale',
    'denied',
    'unavailable',
    'timeout',
    'outside',
    'insecure',
    'unsupported'
  ])
    assert.equal(core.distanceOrigin({state, fix}), null, `${state} must not stand in for the person`);
  assert.equal(core.distanceOrigin({state: 'live', fix: null}), null);
});

test('a usable fix orders rows and supplies their distance text', () => {
  const nearCentre = result('nearCentre', centre);
  const nearFix = result('nearFix', fixCoordinates);
  const fix = [19.2609, 42.4421];
  const ranked = core.rankSearchResults([nearCentre, nearFix], centre, {origin: fix});
  assert.deepEqual(
    ranked.map(result => result.feature.properties.name),
    ['nearFix', 'nearCentre']
  );
  assert.equal(ranked[0].distanceText, '0 m');
  assert.match(ranked[1].distanceText, /^[1-9]\d* m$/);
});

test('without a usable fix the centre orders rows and no distance is shown', () => {
  const nearCentre = result('nearCentre', centre);
  const farFromCentre = result('farFromCentre', [19.5, 42.5]);
  for (const state of ['acquiring', 'stale', 'denied']) {
    const origin = core.distanceOrigin({state, fix: {coordinates: fixCoordinates}});
    const ranked = core.rankSearchResults([farFromCentre, nearCentre], centre, {origin});
    assert.deepEqual(
      ranked.map(result => result.feature.properties.name),
      ['nearCentre', 'farFromCentre'],
      state
    );
    assert.deepEqual(ranked.map(result => result.distanceText), ['', ''], state);
  }
});

test('selectSearchResults forwards the fix origin to ranking', () => {
  const nearCentre = feature('nearCentre', centre);
  const nearFix = feature('nearFix', fixCoordinates);
  const results = core.selectSearchResults({
    places: [nearCentre, nearFix],
    query: '',
    center: centre,
    origin: [19.2609, 42.4421]
  });
  assert.deepEqual(
    results.map(result => result.feature.properties.name),
    ['nearFix', 'nearCentre']
  );
  assert.equal(results[0].distanceText, '0 m');
});

test('distance text uses metres below one kilometre and kilometres above it', () => {
  assert.equal(core.formatDistance(0.042), '42 m');
  assert.equal(core.formatDistance(1.234), '1.2 km');
});
