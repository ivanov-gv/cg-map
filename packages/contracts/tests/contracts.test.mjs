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
const readEditorLayers = () => readJSON('editor-layers.json');
const releasedLayerRules = () => readEditorLayers().layers;
const version5LayerRules = () => readEditorLayers().bundleRules['5'].layers;

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
  // The top-level rules keep the released files; version 5 selects its own set when its bundle is loaded.
  const releasedFiles = [
    ...new Set(
      [...branches.values()]
        .filter(branch => branch.properties.version.const <= 4)
        .flatMap(branch => branch.properties.layers.items.properties.filename.enum)
    )
  ].sort();
  const version5Files = [...branches.get(5).properties.layers.items.properties.filename.enum].sort();
  const editorLayers = readEditorLayers();
  assert.deepEqual(Object.keys(editorLayers.layers).sort(), releasedFiles);
  assert.deepEqual(Object.keys(editorLayers.bundleRules).sort(), ['5']);
  assert.deepEqual(Object.keys(editorLayers.bundleRules['5'].layers).sort(), version5Files);
});

test('editing rules are versioned by the bundle version the Editor loads', () => {
  const schema = readJSON('editor-layers.schema.json');
  const editorLayers = readEditorLayers();
  assert.deepEqual([...schema.required].sort(), ['bundleRules', 'layers', 'localPlaceSource', 'version']);
  assert.equal(schema.properties.layers.$ref, '#/$defs/layerRules');
  assert.deepEqual(Object.keys(schema.properties.bundleRules.properties).sort(), ['5']);
  assert.deepEqual(schema.properties.bundleRules.required, ['5']);
  const version5Schema = schema.properties.bundleRules.properties['5'];
  assert.deepEqual([...version5Schema.required].sort(), ['layers', 'localPlaceSource', 'version']);
  assert.equal(version5Schema.properties.layers.$ref, '#/$defs/layerRules');
  assert.equal(editorLayers.version, 2);
  assert.equal(editorLayers.bundleRules['5'].version, editorLayers.version);
  assert.equal(editorLayers.bundleRules['5'].localPlaceSource, editorLayers.localPlaceSource);
});

test('version 5 keeps the released rules for files the model does not change', () => {
  const version5 = version5LayerRules();
  const released = releasedLayerRules();
  for (const filename of ['bridges.geojson', 'railways.geojson', 'transit-routes.json']) {
    assert.deepEqual(version5[filename], released[filename], filename);
  }
});

test('bridges are an editable polygon layer with only reviewed property rules', () => {
  assert.deepEqual(releasedLayerRules()['bridges.geojson'], {
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
  assert.deepEqual(releasedLayerRules()['railways.geojson'], {
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
  const layers = releasedLayerRules();
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
  const land = releasedLayerRules()['land.geojson'];
  assert.deepEqual(land.operations, ['add', 'modify', 'delete']);
  assert.deepEqual(land.geometries, ['Polygon', 'MultiPolygon']);
  assert.ok(land.editableKinds.includes('shade'));
  assert.ok(land.properties.kind.enum.includes('shade'));
  assert.equal(Object.hasOwn(land.limitedKinds, 'shade'), false);
  assert.deepEqual(land.properties.greenAreaEntityId, {
    pattern: '^((node|way|relation)/[1-9][0-9]*|local:[0-9a-f-]{36})$'
  });
});

// One surface holds the areas that share borders; version 5 describes its stored kinds and labels.
test('version 5 surface rules carry shared-area kinds, links and stored frame facts', () => {
  const surface = version5LayerRules()['surface.geojson'];
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
  assert.deepEqual(surface.properties['ISO3166-2'], {pattern: '^ME-[0-9]+$'});
  assert.deepEqual(surface.properties.population, {type: 'integer', minimum: 0});
  assert.deepEqual(surface.limitedKinds.municipality.properties, [
    'name', 'name:en', 'ISO3166-2', 'population', 'labelPoint'
  ]);
  assert.deepEqual(surface.limitedKinds['unassigned-water'].properties, ['labelPoint']);
  assert.deepEqual(surface.limitedKinds.context.properties, ['name']);
  assert.deepEqual(surface.limitedKinds.sea.properties, []);
  assert.equal(Object.hasOwn(surface.properties, 'country'), false);
  const propertyTypes =
    readJSON('editor-layers.schema.json').$defs.layerRules.additionalProperties.properties.properties
      .additionalProperties.properties.type.enum;
  assert.ok(propertyTypes.includes('position') && propertyTypes.includes('positions'));
});

// Streets, junctions and turn rules are objects in roads.geojson; end levels are released-only facts.
test('version 5 roads hold streets, junctions and turn restrictions without end levels', () => {
  const roads = version5LayerRules()['roads.geojson'];
  const releasedRoads = releasedLayerRules()['roads.geojson'];
  assert.deepEqual(roads.geometries, ['LineString', 'Point', 'None']);
  assert.deepEqual(roads.properties.pathClass.enum, ['park', 'city', 'trail']);
  assert.ok(releasedRoads.properties.pathClass.enum.includes('main'), 'released rules stay frozen');
  for (const name of ['startLevel', 'endLevel']) {
    assert.equal(Object.hasOwn(roads.properties, name), false, name);
    assert.deepEqual(releasedRoads.properties[name], {type: 'integer', minimum: -5, maximum: 5}, name);
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
  const buildings = version5LayerRules()['buildings.geojson'];
  const releasedBuildings = releasedLayerRules()['buildings.geojson'];
  assert.deepEqual(buildings.geometries, ['Polygon', 'Point']);
  assert.deepEqual(buildings.properties.kind.enum, ['building', 'entrance']);
  assert.deepEqual(buildings.properties['addr:streetEntityId'], {pattern: entityIdPattern, reference: 'roads.geojson'});
  assert.deepEqual(buildings.properties.labelPoint, {type: 'position'});
  assert.deepEqual(buildings.properties.labelBearing, {type: 'number', minimum: 0, maximum: 360});
  assert.deepEqual(buildings.properties.iconPoint, {type: 'position'});
  assert.deepEqual(buildings.properties.ref, {maxLength: 128});
  assert.deepEqual(buildings.properties.ref, releasedLayerRules()['building-entrances.geojson'].properties.ref);
  assert.deepEqual(buildings.properties.buildingEntityId, {pattern: entityIdPattern, reference: 'buildings.geojson'});
  assert.deepEqual(buildings.properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  for (const name of poiProperties) {
    assert.ok(Object.hasOwn(buildings.properties, name), name);
  }
  for (const name of ['addr:street', 'energy_class']) {
    assert.equal(Object.hasOwn(buildings.properties, name), false, name);
    assert.ok(Object.hasOwn(releasedBuildings.properties, name), `${name} stays in released rules`);
  }
});

// Places keep stand-alone and inside-building POIs; their visibility is a policy choice, not a stored copy.
test('version 5 places and settlements follow links instead of storing derived facts', () => {
  const layers = version5LayerRules();
  const released = releasedLayerRules();
  assert.deepEqual(layers['places.geojson'].properties.buildingEntityId, {
    pattern: entityIdPattern,
    reference: 'buildings.geojson'
  });
  assert.deepEqual(layers['places.geojson'].properties['addr:streetEntityId'], {
    pattern: entityIdPattern,
    reference: 'roads.geojson'
  });
  assert.deepEqual(layers['places.geojson'].properties.visibilityOverride, {type: 'integer', minimum: 1, maximum: 5});
  for (const name of ['category', 'standalone', 'visibilityLevel', 'addr:street']) {
    assert.equal(Object.hasOwn(layers['places.geojson'].properties, name), false, name);
    assert.ok(Object.hasOwn(released['places.geojson'].properties, name), `${name} stays in released rules`);
  }
  assert.deepEqual(layers['settlements.geojson'].geometries, ['Point', 'Polygon', 'MultiPolygon']);
  assert.deepEqual(layers['settlements.geojson'].properties.settlementEntityId, {
    pattern: entityIdPattern,
    reference: 'settlements.geojson'
  });
  for (const name of ['rank', 'municipality', 'minzoom']) {
    assert.equal(Object.hasOwn(layers['settlements.geojson'].properties, name), false, name);
    assert.ok(Object.hasOwn(released['settlements.geojson'].properties, name), `${name} stays in released rules`);
  }
});

// Relief and rims store only facts; a zoom threshold is a style choice, not a source fact.
test('version 5 relief and rims leave derived values out', () => {
  const layers = version5LayerRules();
  const released = releasedLayerRules();
  assert.deepEqual(layers['relief.geojson'].geometries, ['LineString', 'Point']);
  assert.deepEqual(layers['relief.geojson'].editableKinds, ['contour', 'summit']);
  for (const name of ['index', 'demElevation', 'minzoom', 'description']) {
    assert.equal(Object.hasOwn(layers['relief.geojson'].properties, name), false, name);
  }
  assert.ok(Object.hasOwn(released['summits.geojson'].properties, 'minzoom'), 'released summits stay frozen');
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

test('released stop facts stay in the top-level rules while version 5 drops them', () => {
  const properties = releasedLayerRules()['transport-stops.geojson'].properties;
  assert.deepEqual(properties.stopId, {required: true, maxLength: 64, addOnly: true});
  assert.deepEqual(properties.side, {enum: ['left', 'right']});
  assert.deepEqual(properties.lines, {type: 'list', maxLength: 64});
  const version5Properties = version5LayerRules()['transport-stops.geojson'].properties;
  assert.deepEqual(Object.keys(version5Properties).sort(), ['name', 'name:en', 'stopId']);
});

test('canyon rims state one optional whole-metre width beside their height', () => {
  const rimProperties = readJSON('relief.schema.json').$defs.canyonRim.then.properties;
  assert.equal(rimProperties.width.type, 'integer');
  assert.match(rimProperties.width.description, /omitted width means 0 m: a vertical edge/);
  const layerRules = releasedLayerRules()['canyon-rims.geojson'].properties;
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
