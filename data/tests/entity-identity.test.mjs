import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync, rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Ajv2020 from 'ajv/dist/2020.js';
import {validateSourceEntities} from '../tools/entity-identity.mjs';
import {checkData, validateCollection, validateStops, validateBuildingLabels} from '../tools/check-data.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../packages/contracts/fixtures/entity-identity-cases.json', import.meta.url)));
const collectionWith = properties => ({
  type: 'FeatureCollection',
  entitySchemaVersion: 1,
  features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.25, 42.44]}, properties}]
});

for (const {name, properties} of fixture.valid) {
  test(`source identity accepts ${name} without rewriting it`, () => {
    const collection = collectionWith(structuredClone(properties));
    const before = structuredClone(collection);
    assert.equal(validateCollection(collection), 1);
    assert.deepEqual(collection, before);
  });
}

for (const {name, properties, expectedError} of fixture.invalid) {
  test(`source identity rejects ${name}`, () => {
    assert.throws(() => validateCollection(collectionWith(properties)), new RegExp(`invalid ${expectedError}`));
  });
}

test('identity schema and producer agree on every shared case', () => {
  const schema = JSON.parse(readFileSync(new URL('../../packages/contracts/entity-identity.schema.json', import.meta.url)));
  const validate = new Ajv2020().compile(schema);
  for (const {name, properties} of fixture.valid) {
    assert.equal(validate(properties), true, name);
    assert.doesNotThrow(() => validateSourceEntities(collectionWith(properties)), name);
  }
  for (const {name, properties} of fixture.invalid) {
    assert.equal(validate(properties), false, name);
    assert.throws(() => validateSourceEntities(collectionWith(properties)), undefined, name);
  }
});

test('collection schema resolves the identity contract and validates adopted sources', () => {
  const identity = JSON.parse(readFileSync(new URL('../../packages/contracts/entity-identity.schema.json', import.meta.url)));
  const collection = JSON.parse(readFileSync(new URL('../../packages/contracts/source-entities.schema.json', import.meta.url)));
  const validator = new Ajv2020().addSchema(identity).compile(collection);
  for (const [filename, source] of Object.entries(fixture.sources)) {
    assert.equal(validator(source), true, filename);
  }
  const source = structuredClone(fixture.sources['places.geojson']);
  delete source.entitySchemaVersion;
  assert.equal(validator(source), false, 'missing adoption marker');
  source.entitySchemaVersion = 1;
  source.features[0].properties.entityId = 'unknown:1';
  assert.equal(validator(source), false, 'invalid referenced identity');
});

test('adoption is explicit, supported, and complete across a source file', () => {
  const legacy = collectionWith({kind: 'building'});
  delete legacy.entitySchemaVersion;
  assert.doesNotThrow(() => validateCollection(legacy));
  assert.throws(() => validateCollection({...legacy, entitySchemaVersion: 1}), /entityId/);
  for (const version of [0, 2, '1', null]) {
    assert.throws(() => validateCollection({...legacy, entitySchemaVersion: version}), /unsupported entitySchemaVersion/);
  }
  for (const field of ['entityId', 'entityVersion', 'entityPart']) {
    const partial = structuredClone(legacy);
    partial.features[0].properties[field] = fixture.valid[0].properties[field] ?? 0;
    assert.throws(() => validateCollection(partial), /requires entitySchemaVersion/);
  }
  const partial = collectionWith(fixture.valid[0].properties);
  partial.features.push(legacy.features[0]);
  assert.throws(() => validateCollection(partial), /feature 1: invalid entityId/);
  assert.throws(() => validateSourceEntities(null), /expected FeatureCollection/);
  assert.doesNotThrow(() => validateCollection({type: 'FeatureCollection', entitySchemaVersion: 1, features: []}));
});

test('split entities require distinct part numbers and one source version in either order', () => {
  const properties = fixture.valid[0].properties;
  const first = collectionWith({...properties, entityPart: 0}).features[0];
  const second = collectionWith({...properties, entityPart: 1}).features[0];
  const collection = {type: 'FeatureCollection', entitySchemaVersion: 1, features: [first, second]};
  assert.doesNotThrow(() => validateCollection(collection));
  assert.doesNotThrow(() => validateCollection({...collection, features: [second, first]}));
  for (const change of [
    value => { delete value.features[0].properties.entityPart; },
    value => { delete value.features[1].properties.entityPart; },
    value => { value.features[1].properties.entityPart = 0; },
    value => { value.features[1].properties.entityVersion += 1; }
  ]) {
    const invalid = structuredClone(collection);
    change(invalid);
    assert.throws(() => validateCollection(invalid), /duplicate entityId|versions differ/);
  }
  const unsplit = collectionWith(properties);
  unsplit.features.push(structuredClone(unsplit.features[0]));
  assert.throws(() => validateCollection(unsplit), /duplicate entityId/);
});

test('every source layer can adopt identity without changing its existing domain contract', () => {
  for (const [filename, collection] of Object.entries(fixture.sources)) {
    assert.equal(validateCollection(collection, {label: filename, places: filename === 'places.geojson'}), 1);
  }
  assert.equal(validateStops(fixture.sources['transport-stops.geojson']), 1);
  assert.equal(validateBuildingLabels(fixture.sources['building-labels.geojson'], fixture.sources['buildings.geojson']), 1);
});

// Exercise the real check-data entry point: no source is missed just because it has independent provenance.
test('check-data enforces adopted metadata in all eight source files before provenance checks', testContext => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cg-map-entity-check-'));
  testContext.after(() => rmSync(root, {recursive: true, force: true}));
  const sourceDirectory = path.join(root, 'data/sources');
  mkdirSync(sourceDirectory, {recursive: true});
  mkdirSync(path.join(root, 'packages'), {recursive: true});
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  symlinkSync(path.join(repositoryRoot, 'packages/contracts'), path.join(root, 'packages/contracts'));
  symlinkSync(path.join(repositoryRoot, 'data/artifacts'), path.join(root, 'data/artifacts'));
  // Use links for reviewed inputs; replace only the test's own directory entry, never the linked source.
  const sourceFiles = Object.keys(fixture.sources);
  const supportingFiles = [
    'building-labels.provenance.json', 'transport-stops.provenance.json', 'transit-network.json',
    'transit-network.provenance.json', 'provenance.json', 'place-visibility-policy.json'
  ];
  for (const filename of [...sourceFiles, ...supportingFiles]) {
    symlinkSync(path.join(repositoryRoot, 'data/sources', filename), path.join(sourceDirectory, filename));
  }
  assert.doesNotThrow(() => checkData(root));
  for (const filename of sourceFiles) {
    const originalPath = path.join(repositoryRoot, 'data/sources', filename);
    const testPath = path.join(sourceDirectory, filename);
    const collection = JSON.parse(readFileSync(originalPath));
    collection.entitySchemaVersion = 1;
    unlinkSync(testPath);
    writeFileSync(testPath, JSON.stringify(collection));
    assert.throws(() => checkData(root), /feature 0: invalid entityId/, filename);
    unlinkSync(testPath);
    symlinkSync(originalPath, testPath);
  }
});
