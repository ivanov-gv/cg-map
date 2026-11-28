import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVisibilityConfig, placeVisibilityLevel} from '@ivanov-gv/map-core';
import {behaviorOf, registerBehaviors} from '../src/layers/shared/layer-behaviors.js';
import {importChangeset} from '../src/editing/changeset.js';
import {operationProblem} from '../src/layers/shared/layer-rules.js';
import {placeBehaviors, version5PlaceLinkProblem} from '../src/layers/places/layer-places.js';
import {registerVersion5Behaviors} from '../src/layers/shared/version5-behaviors.js';

registerBehaviors(placeBehaviors);
registerVersion5Behaviors();

const placesFile = 'places.geojson';
const buildingsFile = 'buildings.geojson';
const roadsFile = 'roads.geojson';

const feature = (properties, geometry = {type: 'Point', coordinates: [19.26, 42.44]}) => ({
  type: 'Feature',
  properties,
  geometry
});

const buildingEntry = (key, properties = {kind: 'building', building: 'yes'}) => ({
  filename: buildingsFile,
  key,
  feature: {
    type: 'Feature',
    properties: {entityId: key, ...properties},
    geometry: {type: 'Polygon', coordinates: [[[19, 42], [19.001, 42], [19.001, 42.001], [19, 42.001], [19, 42]]]}
  }
});

const entranceEntry = key => ({
  filename: buildingsFile,
  key,
  feature: {
    type: 'Feature',
    properties: {entityId: key, kind: 'entrance', entrance: 'main'},
    geometry: {type: 'Point', coordinates: [19.0005, 42]}
  }
});

const streetEntry = (key, name = 'Main street') => ({
  filename: roadsFile,
  key,
  feature: {type: 'Feature', properties: {entityId: key, kind: 'street', name}, geometry: null}
});

function contextWith(entriesByFile) {
  const all = entriesByFile;
  return {
    entriesOf: filename => all[filename] ?? [],
    findEntity: (filename, entityId) =>
      (all[filename] ?? []).find(
        ({key, feature: candidate}) => key === entityId || candidate.properties.entityId === entityId
      )
  };
}

const v5Behavior = () => behaviorOf(placesFile, 'objects', 5);
const v5VisibilityConfig = () =>
  parseVisibilityConfig(
    {
      version: 1,
      levels: [
        {level: 1, minZoom: 0},
        {level: 2, minZoom: 10},
        {level: 3, minZoom: 12},
        {level: 4, minZoom: 14},
        {level: 5, minZoom: 16}
      ],
      legacyFallbackLevel: 5
    },
    {fallbackLevel: 5, kinds: {museum: 2, cafe: 4}, categories: {food: 4, essentials: 5}}
  );

test('a version 5 place behavior is used instead of the v1-4 place behavior', () => {
  const behavior = v5Behavior();
  const sections = behavior.sections({properties: {name: 'Cafe', kind: 'cafe'}});
  const fieldNames = sections.flatMap(section => section.fields);
  assert.ok(fieldNames.includes('kind'));
  assert.ok(fieldNames.includes('visibilityOverride'));
  assert.ok(!fieldNames.includes('category'));
  assert.ok(!fieldNames.includes('visibilityLevel'));
  assert.ok(!fieldNames.includes('id'));
  assert.equal(behavior.dragTarget(feature({kind: 'cafe'}), contextWith({[buildingsFile]: []})), null);
});

test('a standalone v5 POI has no buildingEntityId and is valid', () => {
  const behavior = v5Behavior();
  const problem = behavior.problem(
    {feature: feature({name: 'Bench', kind: 'bench'})},
    contextWith({[buildingsFile]: [], [roadsFile]: []})
  );
  assert.equal(problem, null);
});

test('a v5 POI inside a building links by buildingEntityId and the link must exist', () => {
  const behavior = v5Behavior();
  const building = buildingEntry('way/1');
  const context = contextWith({[buildingsFile]: [building], [roadsFile]: []});
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', buildingEntityId: 'way/1'})}, context),
    null
  );
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', buildingEntityId: 'way/999'})}, context),
    'buildingEntityId must name a building in buildings.geojson'
  );
});

test('a v5 POI buildingEntityId must name a building, not an entrance', () => {
  const behavior = v5Behavior();
  const context = contextWith({[buildingsFile]: [entranceEntry('node/10')], [roadsFile]: []});
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', buildingEntityId: 'node/10'})}, context),
    'buildingEntityId must name a building in buildings.geojson'
  );
  assert.equal(
    version5PlaceLinkProblem(feature({name: 'Cafe', kind: 'cafe', buildingEntityId: 'node/10'}), context),
    'buildingEntityId must name a building in buildings.geojson'
  );
});

test('addr:streetEntityId must name a street object in roads.geojson', () => {
  const behavior = v5Behavior();
  const street = streetEntry('way/10', 'Main street');
  const road = {
    filename: roadsFile,
    key: 'way/11',
    feature: {
      type: 'Feature',
      properties: {entityId: 'way/11', kind: 'residential', name: 'Not a street object'},
      geometry: {type: 'LineString', coordinates: [[19, 42], [19.001, 42]]}
    }
  };
  const context = contextWith({[buildingsFile]: [], [roadsFile]: [street, road]});
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', 'addr:streetEntityId': 'way/10'})}, context),
    null
  );
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', 'addr:streetEntityId': 'way/999'})}, context),
    'addr:streetEntityId must name a street object in roads.geojson'
  );
  assert.equal(
    behavior.problem({feature: feature({name: 'Cafe', kind: 'cafe', 'addr:streetEntityId': 'way/11'})}, context),
    'addr:streetEntityId must name a street object in roads.geojson'
  );
});

test('visibilityOverride is available on any v5 POI', () => {
  const behavior = v5Behavior();
  const fields = behavior.sections({properties: {name: 'Cafe', kind: 'cafe'}}).flatMap(section => section.fields);
  const withOverride = behavior
    .sections({properties: {name: 'Cafe', kind: 'cafe', visibilityOverride: 2}})
    .flatMap(section => section.fields);
  assert.ok(fields.includes('visibilityOverride'));
  assert.ok(withOverride.includes('visibilityOverride'));
});

test('a v5 place prepared for Apply does not write id, category, visibilityLevel or standalone', () => {
  const behavior = v5Behavior();
  const prepared = behavior.prepared(
    feature({id: 'node/1', category: 'food', visibilityLevel: 3, standalone: true, name: 'Cafe', kind: 'cafe'})
  );
  assert.equal(prepared.properties.id, undefined);
  assert.equal(prepared.properties.category, undefined);
  assert.equal(prepared.properties.visibilityLevel, undefined);
  assert.equal(prepared.properties.standalone, undefined);
  assert.equal(prepared.properties.name, 'Cafe');
  assert.equal(prepared.properties.kind, 'cafe');
});

test('map-core resolves v5 place visibility from kind, override and policy', () => {
  const config = v5VisibilityConfig();
  assert.equal(placeVisibilityLevel({properties: {entityId: 'n/1', kind: 'museum'}}, config), 2);
  assert.equal(placeVisibilityLevel({properties: {entityId: 'n/2', kind: 'cafe'}}, config), 4);
  assert.equal(placeVisibilityLevel({properties: {entityId: 'n/3', kind: 'unknown_kind'}}, config), 5);
  assert.equal(
    placeVisibilityLevel({properties: {entityId: 'n/4', kind: 'museum', visibilityOverride: 1}}, config),
    1
  );
});

test('moving a v5 POI does not use the legacy drag target when an entrance is present', () => {
  const behavior = v5Behavior();
  const context = contextWith({
    [buildingsFile]: [buildingEntry('way/1'), entranceEntry('node/10')],
    [roadsFile]: []
  });
  assert.equal(behavior.dragTarget({type: 'Point', coordinates: [19.0005, 42.0005]}, context), null);
});

test('v5 place behavior offers building and street pickers', () => {
  const behavior = v5Behavior();
  const controls = behavior.controls({context: contextWith({[buildingsFile]: [], [roadsFile]: []})});
  assert.equal(typeof controls.buildingEntityId, 'function');
  assert.equal(typeof controls['addr:streetEntityId'], 'function');
});

test('working map no longer exports editor-owned place visibility computation', async () => {
  const workingMap = await import('../src/map-tools/working-map.js');
  assert.equal('effectivePlaceVisibilityLevel' in workingMap, false);
  assert.equal('placePolicy' in workingMap, false);
});

test('a v5 place add does not require legacy id/source identity claims', () => {
  const rules = {
    version: 2,
    bundleVersion: 5,
    localPlaceSource: 'OpenStreetMap',
    layers: {
      [placesFile]: {
        operations: ['add', 'modify', 'delete'],
        geometries: ['Point'],
        properties: {
          kind: {requiredOnAdd: true, enum: ['cafe', 'bench']},
          name: {maxLength: 120},
          'addr:streetEntityId': {maxLength: 64},
          buildingEntityId: {maxLength: 64}
        }
      }
    }
  };
  const levels = new Set([1, 2, 3, 4, 5]);
  const problem = operationProblem(
    {
      filename: placesFile,
      operation: 'add',
      reference: {localId: 'local:00000000-0000-4000-8000-000000000001'},
      before: null,
      after: feature({kind: 'cafe', name: 'Corner cafe'})
    },
    rules,
    levels
  );
  assert.equal(problem, null);
});

test('import refuses a v5 place whose buildingEntityId does not name a building', async () => {
  const building = buildingEntry('way/1');
  const sources = new Map([
    [placesFile, {metadata: {sha256: 'p'}, collection: {type: 'FeatureCollection', features: []}}],
    [buildingsFile, {metadata: {sha256: 'b'}, collection: {type: 'FeatureCollection', features: [building.feature]}}]
  ]);
  const session = {
    changedFiles: () => [],
    isChanged: () => false,
    workingEntries: filename => (filename === buildingsFile ? [building] : []),
    recordEdits: () => assert.fail('invalid import must not be recorded'),
    saveFieldItem: () => assert.fail('invalid import must not be recorded')
  };
  const rules = {
    version: 2,
    bundleVersion: 5,
    localPlaceSource: 'OpenStreetMap',
    layers: {
      [placesFile]: {
        operations: ['add', 'modify', 'delete'],
        geometries: ['Point'],
        properties: {
          kind: {requiredOnAdd: true, enum: ['cafe']},
          name: {maxLength: 120},
          buildingEntityId: {maxLength: 64}
        }
      },
      [buildingsFile]: {
        operations: ['add', 'modify', 'delete'],
        geometries: ['Polygon'],
        properties: {kind: {requiredOnAdd: true, enum: ['building']}, building: {required: true, enum: ['yes']}}
      }
    }
  };
  const changeset = {
    version: 2,
    id: 'c1',
    createdAt: '2026-11-28T00:00:00Z',
    author: 'test',
    reason: 'test',
    bases: {[placesFile]: 'p', [buildingsFile]: 'b'},
    operations: [
      {
        filename: placesFile,
        operation: 'add',
        reference: {localId: 'local:00000000-0000-4000-8000-000000000001'},
        before: null,
        beforeFingerprint: null,
        after: feature({kind: 'cafe', name: 'Corner cafe', buildingEntityId: 'node/999'})
      }
    ]
  };
  await assert.rejects(
    () => importChangeset(changeset, session, sources, rules, new Set([1, 2, 3, 4, 5])),
    /buildingEntityId must name a building/
  );
});
