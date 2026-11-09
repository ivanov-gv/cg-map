import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {writeEditorBundle} from '../../data/tools/editor-bundle.mjs';
import {validateCollection, validateStops, validateBuildingLabels} from '../../data/tools/check-data.mjs';
import {decodeSource, validateBundleManifest} from '../../apps/editor/src/source-bundle.js';
import {normalizePlaces, parseVisibilityConfig, markerKeys} from '@ivanov-gv/map-core';
import {matchesPlaceSearch, selectNearestPlaces} from '../../apps/web/src/core.js';

// Run the same source features through domain validation, real byte-preserving assembly and both consumers.
test('entity-aware sources pass producer validation and reach editor and web without identity loss', async testContext => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-identity-roundtrip-'));
  testContext.after(() => rm(directory, {recursive: true, force: true}));
  const sourceDirectory = path.join(directory, 'sources');
  const outputDirectory = path.join(directory, 'bundle');
  await mkdir(sourceDirectory);
  const fixture = JSON.parse(await readFile(new URL('../../packages/contracts/fixtures/entity-identity-cases.json', import.meta.url)));
  for (const [filename, collection] of Object.entries(fixture.sources)) {
    assert.equal(validateCollection(collection, {label: filename, places: filename === 'places.geojson'}), 1);
    await writeFile(path.join(sourceDirectory, filename), JSON.stringify(collection));
  }
  assert.equal(validateStops(fixture.sources['transport-stops.geojson']), 1);
  assert.equal(validateBuildingLabels(fixture.sources['building-labels.geojson'], fixture.sources['buildings.geojson']), 1);
  const manifest = validateBundleManifest(await writeEditorBundle(sourceDirectory, outputDirectory));
  const decodedSources = new Map();
  for (const metadata of manifest.layers) {
    const bytes = await readFile(path.join(outputDirectory, metadata.filename));
    const decoded = await decodeSource(bytes, metadata);
    assert.deepEqual(decoded, fixture.sources[metadata.filename]);
    decodedSources.set(metadata.filename, decoded);
  }
  const config = parseVisibilityConfig(JSON.parse(await readFile(new URL('../../packages/contracts/place-visibility.json', import.meta.url))));
  const [place] = normalizePlaces(decodedSources.get('places.geojson').features, config);
  const sourcePlace = fixture.sources['places.geojson'].features[0];
  assert.deepEqual(place, sourcePlace);
  assert.equal(matchesPlaceSearch(place, 'cafe', 'food'), true);
  assert.equal(selectNearestPlaces([place], [19.25, 42.44])[0].feature, place);
  assert.equal(markerKeys([place]).get(sourcePlace.properties.id), sourcePlace.properties.id);
});
