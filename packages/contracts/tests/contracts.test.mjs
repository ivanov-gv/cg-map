import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const contractsDirectory = new URL('../', import.meta.url);
const readJSON = relativePath => JSON.parse(readFileSync(new URL(relativePath, contractsDirectory)));
const jsonFiles = readdirSync(contractsDirectory).filter(filename => filename.endsWith('.json'));
const entityIdPattern = '^((node|way|relation)/[1-9][0-9]*|local:[0-9a-f-]{36})$';
const poiProperties = [
  'name:sr-Latn',
  'addr:streetEntityId',
  'addr:housenumber',
  'phone',
  'website',
  'email',
  'opening_hours',
  'wheelchair',
  'level',
  'cuisine',
  'wikidata',
  'wikipedia'
];

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
  assert.deepEqual(schema.properties.version.enum, [1, 2, 3, 4, 5]);
  const branches = new Map(schema.oneOf.map(branch => [branch.properties.version.const, branch]));
  assert.deepEqual([...branches.keys()].sort(), [1, 2, 3, 4, 5]);
  // The producer still emits version 3, so the declared versions must not move the branch it finds with at(-1).
  assert.equal(schema.oneOf.at(-1).properties.version.const, 3);
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
    [4, ['bridges.geojson', 'railways.geojson']],
    [5, ['relief.geojson', 'surface.geojson']]
  ]);
  const removals = new Map([
    [4, ['slopes.geojson']],
    [5, [
      'border-edges.geojson',
      'building-entrances.geojson',
      'building-labels.geojson',
      'context-countries.geojson',
      'contours.geojson',
      'land.geojson',
      'municipalities.geojson',
      'protected-areas.geojson',
      'ridges.geojson',
      'road-nodes.geojson',
      'settlement-areas.geojson',
      'summits.geojson',
      'turn-restrictions.json',
      'water.geojson'
    ]]
  ]);
  let previousFiles = [];
  for (const version of [1, 2, 3, 4, 5]) {
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
  // The rules are not versioned: they keep the files of released versions while adding the pending version-5 files.
  const declaredFiles = [
    ...new Set([...branches.values()].flatMap(branch => branch.properties.layers.items.properties.filename.enum))
  ].sort();
  assert.deepEqual(Object.keys(readJSON('editor-layers.json').layers).sort(), declaredFiles);
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

// A limited kind cannot be added, so the shade link is an editable land kind with an entity-ID pattern.
test('land rules offer a shade kind with a green-area entity-ID pattern', () => {
  const land = readJSON('editor-layers.json').layers['land.geojson'];
  assert.deepEqual(land.operations, ['add', 'modify', 'delete']);
  assert.deepEqual(land.geometries, ['Polygon', 'MultiPolygon']);
  assert.ok(land.editableKinds.includes('shade'));
  assert.ok(land.properties.kind.enum.includes('shade'));
  assert.equal(Object.hasOwn(land.limitedKinds, 'shade'), false);
  assert.deepEqual(land.properties.greenAreaEntityId, {
    pattern: '^((node|way|relation)/[1-9][0-9]*|local:[0-9a-f-]{36})$'
  });
});

// One surface holds the areas that share borders; the editor rules describe the file's kinds and stored labels.
test('version 5 surface rules carry shared-area kinds, links and movable labels', () => {
  const surface = readJSON('editor-layers.json').layers['surface.geojson'];
  assert.deepEqual(surface.geometries, ['Polygon', 'MultiPolygon', 'LineString']);
  for (const kind of [
    'park', 'garden', 'woods', 'meadow', 'grass', 'scrub', 'sports', 'cemetery', 'playground', 'shade',
    'lake', 'river', 'reservoir', 'pond', 'basin', 'water', 'stream', 'canal', 'ditch', 'drain',
    'protected-area'
  ]) {
    assert.ok(surface.editableKinds.includes(kind), kind);
    assert.ok(surface.properties.kind.enum.includes(kind), kind);
  }
  for (const kind of ['municipality', 'unassigned-water', 'context', 'sea']) {
    assert.equal(surface.limitedKinds[kind].operations[0], 'modify', kind);
    assert.equal(surface.editableKinds.includes(kind), false, kind);
  }
  assert.deepEqual(
    [...surface.properties.kind.enum].sort(),
    [...surface.editableKinds, ...Object.keys(surface.limitedKinds)].sort()
  );
  assert.deepEqual(surface.properties.greenAreaEntityId, {pattern: entityIdPattern, reference: 'surface.geojson'});
  assert.deepEqual(surface.properties.riverEntityId, {pattern: entityIdPattern, reference: 'surface.geojson'});
  assert.deepEqual(surface.properties.labelPoint, {type: 'position'});
  assert.deepEqual(surface.properties.labelLine, {type: 'positions'});
  assert.deepEqual(surface.properties.iconPoint, {type: 'position'});
  assert.deepEqual(surface.properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  for (const name of poiProperties) {
    assert.ok(Object.hasOwn(surface.properties, name), name);
  }
  const propertyTypes = readJSON('editor-layers.schema.json').properties.layers.additionalProperties.properties.properties
    .additionalProperties.properties.type.enum;
  assert.ok(propertyTypes.includes('position') && propertyTypes.includes('positions'));
});

// Streets, junctions and turn rules are objects in roads.geojson; released level facts stay in the shared rules.
test('version 5 roads hold streets, junctions and turn restrictions', () => {
  const roads = readJSON('editor-layers.json').layers['roads.geojson'];
  assert.deepEqual(roads.geometries, ['LineString', 'Point', 'None']);
  for (const kind of ['park', 'city', 'trail']) {
    assert.ok(roads.properties.pathClass.enum.includes(kind), kind);
  }
  for (const name of ['startLevel', 'endLevel']) {
    assert.deepEqual(roads.properties[name], {type: 'integer', minimum: -5, maximum: 5}, name);
  }
  assert.deepEqual(roads.properties.streetEntityId, {pattern: entityIdPattern, reference: 'roads.geojson'});
  assert.deepEqual(roads.properties.level, {type: 'integer', minimum: -5, maximum: 5});
  for (const name of ['crossing', 'traffic_signals', 'restriction', 'from', 'to', 'viaNodes', 'viaWays']) {
    assert.ok(Object.hasOwn(roads.properties, name), name);
  }
  for (const kind of ['street', 'junction', 'restriction']) {
    assert.ok(roads.properties.kind.enum.includes(kind), kind);
  }
});

// Entrances and labels live on buildings; a business POI is the building's own tags and icon point.
test('version 5 buildings carry entrances, labels and business tags in one file', () => {
  const buildings = readJSON('editor-layers.json').layers['buildings.geojson'];
  assert.deepEqual(buildings.geometries, ['Polygon', 'Point']);
  assert.deepEqual(buildings.properties.kind.enum, ['building', 'entrance']);
  assert.deepEqual(buildings.properties['addr:streetEntityId'], {pattern: entityIdPattern, reference: 'roads.geojson'});
  assert.deepEqual(buildings.properties.labelPoint, {type: 'position'});
  assert.deepEqual(buildings.properties.labelBearing, {type: 'number', minimum: 0, maximum: 360});
  assert.deepEqual(buildings.properties.iconPoint, {type: 'position'});
  assert.deepEqual(buildings.properties.buildingEntityId, {pattern: entityIdPattern, reference: 'buildings.geojson'});
  assert.deepEqual(buildings.properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  for (const name of poiProperties) {
    assert.ok(Object.hasOwn(buildings.properties, name), name);
  }
});

// Places keep stand-alone and inside-building POIs; their visibility is a policy choice, not a stored copy.
test('version 5 places and settlements follow links instead of storing derived facts', () => {
  const layers = readJSON('editor-layers.json').layers;
  assert.deepEqual(layers['places.geojson'].properties.buildingEntityId, {
    pattern: entityIdPattern,
    reference: 'buildings.geojson'
  });
  assert.deepEqual(layers['places.geojson'].properties['addr:streetEntityId'], {
    pattern: entityIdPattern,
    reference: 'roads.geojson'
  });
  assert.deepEqual(layers['places.geojson'].properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  assert.deepEqual(layers['settlements.geojson'].geometries, ['Point', 'Polygon', 'MultiPolygon']);
  assert.deepEqual(layers['settlements.geojson'].properties.settlementEntityId, {
    pattern: entityIdPattern,
    reference: 'settlements.geojson'
  });
});

// Relief and rims store only facts; released stop facts stay in the shared rules until data emits version 5.
test('version 5 relief and rims leave derived values out', () => {
  const layers = readJSON('editor-layers.json').layers;
  assert.deepEqual(layers['relief.geojson'].geometries, ['LineString', 'Point']);
  assert.deepEqual(layers['relief.geojson'].editableKinds, ['contour', 'summit']);
  assert.equal(Object.hasOwn(layers['relief.geojson'].properties, 'index'), false);
  assert.equal(Object.hasOwn(layers['relief.geojson'].properties, 'demElevation'), false);
  assert.deepEqual(layers['relief.geojson'].properties.iconPoint, {type: 'position'});
  assert.deepEqual(layers['relief.geojson'].properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  for (const name of poiProperties) {
    assert.ok(Object.hasOwn(layers['relief.geojson'].properties, name), name);
  }
  assert.deepEqual(layers['canyon-rims.geojson'].properties.bank, {enum: ['left', 'right']});
  assert.deepEqual(layers['canyon-rims.geojson'].properties.riverEntityId, {
    pattern: entityIdPattern,
    reference: 'surface.geojson'
  });
  assert.equal(layers['canyon-rims.geojson'].properties.lengthMetres, undefined);
});

test('released stop facts stay in the shared rules while version 5 drops them', () => {
  const properties = readJSON('editor-layers.json').layers['transport-stops.geojson'].properties;
  assert.deepEqual(properties.stopId, {required: true, maxLength: 64, addOnly: true});
  assert.deepEqual(properties.side, {enum: ['left', 'right']});
  assert.deepEqual(properties.lines, {type: 'list', maxLength: 64});
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
