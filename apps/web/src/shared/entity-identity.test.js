import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePlaces, parseVisibilityConfig, markerKeys} from '@ivanov-gv/map-core';
import {matchesPlaceSearch, selectNearestPlaces} from './core.js';

const readContract = name => JSON.parse(readFileSync(new URL(import.meta.resolve(`@ivanov-gv/map-contracts/${name}`))));
const fixture = readContract('fixtures/entity-identity-cases.json');
const levels = parseVisibilityConfig(readContract('place-visibility.json'));

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
