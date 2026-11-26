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

test('editor bundle versions freeze each version and add to the one before', () => {
  const schema = readJSON('editor-bundle.schema.json');
  assert.deepEqual(schema.properties.version.enum, [1, 2, 3]);
  const [version1, version2, version3] = schema.oneOf;
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
  const version3Files = version3.properties.layers.items.properties.filename.enum;
  assert.deepEqual(
    version3Files,
    [
      ...version2Files,
      'canyon-rims.geojson',
      'contours.geojson',
      'protected-areas.geojson',
      'ridges.geojson',
      'settlement-areas.geojson',
      'slopes.geojson',
      'summits.geojson',
      'transit-routes.json',
      'turn-restrictions.json'
    ].sort()
  );
  assert.equal(version3.properties.version.const, 3);
  assert.equal(version3.properties.layers.minItems, version3Files.length);
  assert.equal(version3.properties.layers.maxItems, version3Files.length);
  assert.equal(version1.properties.layers.minItems, version1Files.length);
  assert.equal(version1.properties.layers.maxItems, version1Files.length);
  assert.equal(version2.properties.layers.minItems, version2Files.length);
  assert.equal(version2.properties.layers.maxItems, version2Files.length);
});

// A bundled file without rules could be shown and never edited, and rules without a file could never be reached.
test('the editing rules cover exactly the files of the current bundle', () => {
  const currentVersion = readJSON('editor-bundle.schema.json').oneOf.at(-1);
  const bundledFiles = currentVersion.properties.layers.items.properties.filename.enum;
  assert.deepEqual(Object.keys(readJSON('editor-layers.json').layers).sort(), [...bundledFiles].sort());
});

test('canyon rims state one optional whole-metre width beside their height', () => {
  const rimProperties = readJSON('relief.schema.json').$defs.canyonRim.then.properties;
  assert.equal(rimProperties.width.type, 'integer');
  assert.match(rimProperties.width.description, /omitted width means 0 m: a vertical edge/);
  const layerRules = readJSON('editor-layers.json').layers['canyon-rims.geojson'].properties;
  assert.deepEqual(layerRules.width, {type: 'integer', minimum: 0, maximum: 2000});
  const widthCases = readJSON('fixtures/editor-property-cases.json').cases.filter(
    ({properties}) => Object.hasOwn(properties, 'width')
  );
  assert.ok(widthCases.some(({properties, isValid}) => isValid && properties.width === 0), 'zero width is valid');
  assert.ok(widthCases.some(({properties, isValid}) => isValid && properties.width > 0), 'a painted width is valid');
  assert.ok(widthCases.some(({isValid}) => !isValid), 'an invalid width case is shared');
});

test('shared fixtures are valid JSON', () => {
  for (const filename of readdirSync(new URL('fixtures/', contractsDirectory))) {
    assert.doesNotThrow(() => readJSON(`fixtures/${filename}`), filename);
  }
});
