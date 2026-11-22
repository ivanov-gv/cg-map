import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const contractsDirectory = new URL('../', import.meta.url);
const readJSON = relativePath => JSON.parse(readFileSync(new URL(relativePath, contractsDirectory)));
const jsonFiles = readdirSync(contractsDirectory).filter(filename => filename.endsWith('.json'));

// Producers and consumers test their own use of these files; this project only guards the files themselves.
test('every published schema declares its dialect, title and shape', () => {
  const schemaFiles = jsonFiles.filter(filename => filename.endsWith('.schema.json'));
  assert.ok(schemaFiles.length > 0);
  for (const filename of schemaFiles) {
    const schema = readJSON(filename);
    assert.ok(schema.$schema, `${filename} needs $schema`);
    assert.ok(schema.title, `${filename} needs a title`);
    assert.ok(schema.type || schema.properties, `${filename} needs a shape`);
  }
});

test('the level table has consecutive levels with increasing zooms and an admitted fallback', () => {
  const {levels, legacyFallbackLevel} = readJSON('place-visibility.json');
  levels.forEach((entry, index) => {
    assert.equal(entry.level, index + 1);
    if (index > 0) assert.ok(entry.minZoom > levels[index - 1].minZoom);
  });
  assert.ok(levels.some(entry => entry.level === legacyFallbackLevel));
});

test('editor bundle versions keep version 1 frozen and version 2 additive', () => {
  const schema = readJSON('editor-bundle.schema.json');
  assert.deepEqual(schema.properties.version.enum, [1, 2]);
  const [version1, version2] = schema.oneOf;
  assert.equal(version1.properties.version.const, 1);
  assert.equal(version2.properties.version.const, 2);
  const originalFiles = [
    'building-labels.geojson',
    'buildings.geojson',
    'context-countries.geojson',
    'land.geojson',
    'places.geojson',
    'roads.geojson',
    'transport-stops.geojson',
    'water.geojson'
  ];
  const version1Files = version1.properties.layers.items.properties.filename.enum;
  const version2Files = version2.properties.layers.items.properties.filename.enum;
  assert.deepEqual(version1Files, originalFiles);
  assert.deepEqual(
    version2Files,
    [
      ...originalFiles,
      'building-entrances.geojson',
      'road-nodes.geojson',
      'border-edges.geojson',
      'municipalities.geojson',
      'settlements.geojson'
    ].sort()
  );
  assert.equal(version1.properties.layers.minItems, version1Files.length);
  assert.equal(version1.properties.layers.maxItems, version1Files.length);
  assert.equal(version2.properties.layers.minItems, version2Files.length);
  assert.equal(version2.properties.layers.maxItems, version2Files.length);
});

test('shared fixtures are valid JSON', () => {
  for (const filename of readdirSync(new URL('fixtures/', contractsDirectory))) {
    assert.doesNotThrow(() => readJSON(`fixtures/${filename}`), filename);
  }
});
