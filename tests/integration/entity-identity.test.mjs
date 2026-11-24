import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {dataToolURL} from '../data-root.mjs';
import {contractURL, contractsDirectory, readContractJSON} from '../contracts-root.mjs';
import {decodeSource, validateBundleManifest} from '../../apps/editor/src/source-bundle.js';
import {normalizePlaces, parseVisibilityConfig, markerKeys} from '@ivanov-gv/map-core';
import {matchesPlaceSearch, selectNearestPlaces} from '../../apps/web/src/core.js';

const {writeEditorBundle} = await import(dataToolURL('editor-bundle.mjs'));
const {validateCollection, validateStops, validateBuildingLabels} = await import(dataToolURL('check-data.mjs'));

// Run the same source features through domain validation, real byte-preserving assembly and both consumers.
test('entity-aware sources pass producer validation and reach editor and web without identity loss', async testContext => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-identity-roundtrip-'));
  testContext.after(() => rm(directory, {recursive: true, force: true}));
  const sourceDirectory = path.join(directory, 'sources');
  const outputDirectory = path.join(directory, 'bundle');
  await mkdir(sourceDirectory);
  const fixture = readContractJSON('fixtures/entity-identity-cases.json');
  for (const [filename, collection] of Object.entries(fixture.sources)) {
    assert.equal(validateCollection(collection, {label: filename, places: filename === 'places.geojson', contractsDirectory}), 1);
    await writeFile(path.join(sourceDirectory, filename), JSON.stringify(collection));
  }
  // The fixture states identity cases for the files that had them first; the bundle also needs the later files present.
  const bundledFiles = readContractJSON('editor-bundle.schema.json').oneOf.at(-1).properties.layers.items.properties.filename.enum;
  for (const filename of bundledFiles.filter(name => !Object.hasOwn(fixture.sources, name))) {
    const emptyContent = filename.endsWith('.json')
      ? {routes: [], restrictions: []}
      : {type: 'FeatureCollection', entitySchemaVersion: 1, features: []};
    await writeFile(path.join(sourceDirectory, filename), JSON.stringify(emptyContent));
  }
  assert.equal(validateStops(fixture.sources['transport-stops.geojson'], {contractsDirectory}), 1);
  assert.equal(validateBuildingLabels(fixture.sources['building-labels.geojson'], fixture.sources['buildings.geojson'], {contractsDirectory}), 1);
  const manifest = validateBundleManifest(await writeEditorBundle(sourceDirectory, outputDirectory, contractURL('editor-bundle.schema.json')));
  const decodedSources = new Map();
  for (const metadata of manifest.layers) {
    const bytes = await readFile(path.join(outputDirectory, metadata.filename));
    const decoded = await decodeSource(bytes, metadata);
    const source = fixture.sources[metadata.filename];
    if (source) assert.deepEqual(decoded, source);
    decodedSources.set(metadata.filename, decoded);
  }
  const config = parseVisibilityConfig(readContractJSON('place-visibility.json'));
  const [place] = normalizePlaces(decodedSources.get('places.geojson').features, config);
  const sourcePlace = fixture.sources['places.geojson'].features[0];
  assert.deepEqual(place, sourcePlace);
  assert.equal(matchesPlaceSearch(place, 'cafe', 'food'), true);
  assert.equal(selectNearestPlaces([place], [19.25, 42.44])[0].feature, place);
  assert.equal(markerKeys([place]).get(sourcePlace.properties.id), sourcePlace.properties.id);
});
