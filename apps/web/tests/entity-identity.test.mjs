import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePlaces, parseVisibilityConfig, markerKeys} from '@ivanov-gv/map-core';
import {matchesPlaceSearch, selectNearestPlaces} from '../src/core.js';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/contracts/fixtures/entity-identity-cases.json', import.meta.url)));
const levels = parseVisibilityConfig(JSON.parse(readFileSync(new URL('../../../packages/contracts/place-visibility.json', import.meta.url))));

// Source metadata must not replace the public directory's ID or disappear during normalization and search.
for (const {name, properties} of fixture.valid) {
  test(`web preserves entity metadata for ${name}`, () => {
    const source = structuredClone(fixture.sources['places.geojson'].features[0]);
    Object.assign(source.properties, properties);
    const before = structuredClone(source);
    const [place] = normalizePlaces([source], levels);
    assert.deepEqual(place, before);
    assert.deepEqual(source, before);
    assert.equal(markerKeys([place]).get(before.properties.id), before.properties.id);
    assert.equal(matchesPlaceSearch(place, 'cafe', 'food'), true);
    assert.equal(selectNearestPlaces([place], [19.25, 42.44])[0].feature, place);
  });
}
