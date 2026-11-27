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
  assert.deepEqual(schema.properties.version.enum, [1, 2, 3, 4]);
  const branches = new Map(schema.oneOf.map(branch => [branch.properties.version.const, branch]));
  assert.deepEqual([...branches.keys()].sort(), [1, 2, 3, 4]);
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
  const additions = new Map([
    [1, originalFiles],
    [
      2,
      [
        'building-entrances.geojson',
        'road-nodes.geojson',
        'border-edges.geojson',
        'municipalities.geojson',
        'settlements.geojson'
      ]
    ],
    [
      3,
      [
        'canyon-rims.geojson',
        'contours.geojson',
        'protected-areas.geojson',
        'ridges.geojson',
        'settlement-areas.geojson',
        'slopes.geojson',
        'summits.geojson',
        'transit-routes.json',
        'turn-restrictions.json'
      ]
    ],
    [4, ['bridges.geojson', 'railways.geojson']]
  ]);
  const removals = new Map([[4, ['slopes.geojson']]]);
  let previousFiles = [];
  for (const version of [1, 2, 3, 4]) {
    const branch = branches.get(version);
    const files = branch.properties.layers.items.properties.filename.enum;
    const removedFiles = removals.get(version) ?? [];
    const retainedFiles = previousFiles.filter(filename => !removedFiles.includes(filename));
    assert.deepEqual(files, [...retainedFiles, ...additions.get(version)].sort());
    assert.equal(branch.properties.layers.minItems, files.length);
    assert.equal(branch.properties.layers.maxItems, files.length);
    assert.deepEqual([...new Set(files)].sort(), files);
    previousFiles = files;
  }
  // A bundled file without rules could be shown and never edited, and rules without a file could never be reached.
  // The rules cover both the emitted version 3 and the pending version 4 the Editor will read next.
  const emittedAndPendingFiles = [
    ...new Set([...branches.get(3).properties.layers.items.properties.filename.enum, ...previousFiles])
  ].sort();
  assert.deepEqual(Object.keys(readJSON('editor-layers.json').layers).sort(), emittedAndPendingFiles);
});

test('bridges are an editable polygon layer with only reviewed property rules', () => {
  assert.deepEqual(readJSON('editor-layers.json').layers['bridges.geojson'], {
    operations: ['add', 'modify', 'delete'],
    geometries: ['Polygon'],
    properties: {
      kind: {requiredOnAdd: true, enum: ['bridge']},
      name: {maxLength: 128},
      'name:en': {maxLength: 128},
      method: {enum: ['osm', 'traced'], addOnly: true},
      osmTag: {enum: ['man_made=bridge'], addOnly: true},
      sourceRoadIds: {type: 'list', maxLength: 64, pattern: '^(way|relation)/[1-9][0-9]*$', addOnly: true}
    }
  });
});

test('railways are editable as stored, with only the reviewed property rules', () => {
  assert.deepEqual(readJSON('editor-layers.json').layers['railways.geojson'], {
    operations: ['add', 'modify', 'delete'],
    geometries: ['Point', 'LineString', 'Polygon'],
    properties: {
      kind: {requiredOnAdd: true, enum: ['disused_rail', 'halt', 'platform', 'rail', 'station']},
      name: {maxLength: 128},
      osmTag: {
        enum: ['disused:railway=rail', 'railway=halt', 'railway=platform', 'railway=rail', 'railway=station'],
        addOnly: true
      },
      gauge: {maxLength: 128},
      ref: {maxLength: 128}
    }
  });
});

// The sun's direction is one derivation convention, not a fact repeated on each ridge.
test('ridges are drawn facts with only the reviewed property rules', () => {
  const layers = readJSON('editor-layers.json').layers;
  assert.deepEqual(layers['ridges.geojson'], {
    operations: ['add', 'modify', 'delete'],
    geometries: ['LineString'],
    properties: {
      kind: {requiredOnAdd: true, enum: ['ridge']},
      summit: {pattern: '^((node|way|relation)/[1-9][0-9]*|local:[0-9a-f-]{36})$'},
      summitName: {maxLength: 120},
      name: {maxLength: 120}
    }
  });
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
