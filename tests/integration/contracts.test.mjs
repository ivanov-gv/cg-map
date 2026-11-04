import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {categories} from '../../apps/web/src/core.js';
import {parseVisibilityConfig, normalizePlaces, assertPublishedPlaces} from '../../apps/web/src/place-visibility.js';

test('web categories agree with the published place contract', () => {
  const contract = JSON.parse(fs.readFileSync('packages/contracts/places.schema.json'));
  assert.deepEqual(Object.keys(categories).filter(key => key !== 'all').sort(), contract.properties.properties.properties.category.enum.slice().sort());
});

test('producer and consumer share one visibility configuration and the published snapshot satisfies it', () => {
  const raw = fs.readFileSync('packages/contracts/place-visibility.json');
  const config = parseVisibilityConfig(JSON.parse(raw));
  const levelSchema = JSON.parse(fs.readFileSync('packages/contracts/places.schema.json')).properties.properties.properties.visibilityLevel;
  assert.deepEqual([levelSchema.minimum, levelSchema.maximum], [config.levels[0], config.levels.at(-1)]);
  const places = JSON.parse(fs.readFileSync('data/sources/places.geojson')).features;
  assert.doesNotThrow(() => assertPublishedPlaces(places, config));
  assert.equal(normalizePlaces(places, config).length, places.length);
  assert.deepEqual(fs.readFileSync('dist/web/data/place-visibility.json'), raw);
  assert.ok(JSON.parse(fs.readFileSync('dist/web/data/manifest.json')).shell.includes('data/place-visibility.json'));
});
