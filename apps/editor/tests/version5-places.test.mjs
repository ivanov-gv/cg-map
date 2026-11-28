import test from 'node:test';
import assert from 'node:assert/strict';
import {behaviorOf, registerBehaviors} from '../src/layers/shared/layer-behaviors.js';
import {placeBehaviors} from '../src/layers/places/layer-places.js';
import {registerVersion5Behaviors} from '../src/layers/shared/version5-behaviors.js';
import {effectivePlaceVisibilityLevel} from '../src/map-tools/working-map.js';

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
  feature: {type: 'Feature', properties: {entityId: key, ...properties}, geometry: {type: 'Polygon', coordinates: [[[19, 42], [19.001, 42], [19.001, 42.001], [19, 42]]]}}
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

const v5Behavior = () => behaviorOf(placesFile, 'places', 5);

test('a version 5 place behavior is used instead of the v1-4 place behavior', () => {
  const behavior = v5Behavior();
  const sections = behavior.sections({properties: {name: 'Cafe', kind: 'cafe'}});
  const fieldNames = sections.flatMap(section => section.fields);
  assert.ok(fieldNames.includes('kind'));
  assert.ok(!fieldNames.includes('category'));
  assert.ok(!fieldNames.includes('visibilityLevel'));
  assert.ok(!fieldNames.includes('id'));
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

test('addr:streetEntityId must name a street object in roads.geojson', () => {
  const behavior = v5Behavior();
  const street = streetEntry('way/10', 'Main street');
  const road = {
    filename: roadsFile,
    key: 'way/11',
    feature: {type: 'Feature', properties: {entityId: 'way/11', kind: 'residential', name: 'Not a street object'}, geometry: {type: 'LineString', coordinates: [[19, 42], [19.001, 42]]}}
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

test('visibilityOverride is shown only on a POI that has one', () => {
  const behavior = v5Behavior();
  const without = behavior.sections({properties: {name: 'Cafe', kind: 'cafe'}});
  const withOverride = behavior.sections({properties: {name: 'Cafe', kind: 'cafe', visibilityOverride: 2}});
  assert.ok(!without.flatMap(section => section.fields).includes('visibilityOverride'));
  assert.ok(withOverride.flatMap(section => section.fields).includes('visibilityOverride'));
});

test('a v5 place prepared for Apply does not write id, category, visibilityLevel or standalone', () => {
  const behavior = v5Behavior();
  const prepared = behavior.prepared(feature({
    id: 'node/1',
    category: 'food',
    visibilityLevel: 3,
    standalone: true,
    name: 'Cafe',
    kind: 'cafe'
  }));
  assert.equal(prepared.properties.id, undefined);
  assert.equal(prepared.properties.category, undefined);
  assert.equal(prepared.properties.visibilityLevel, undefined);
  assert.equal(prepared.properties.standalone, undefined);
  assert.equal(prepared.properties.name, 'Cafe');
  assert.equal(prepared.properties.kind, 'cafe');
});

test('per-kind defaults come from the policy table and visibilityOverride wins when set', () => {
  const policy = {
    fallbackLevel: 5,
    kinds: {museum: 2, cafe: 4},
    categories: {food: 4, essentials: 5}
  };
  assert.equal(effectivePlaceVisibilityLevel({kind: 'museum'}, policy), 2);
  assert.equal(effectivePlaceVisibilityLevel({kind: 'cafe'}, policy), 4);
  assert.equal(effectivePlaceVisibilityLevel({kind: 'unknown_kind'}, policy), 5);
  assert.equal(effectivePlaceVisibilityLevel({kind: 'museum', visibilityOverride: 1}, policy), 1);
});

test('v5 place behavior offers building and street pickers', () => {
  const behavior = v5Behavior();
  const controls = behavior.controls({context: contextWith({[buildingsFile]: [], [roadsFile]: []})});
  assert.equal(typeof controls.buildingEntityId, 'function');
  assert.equal(typeof controls['addr:streetEntityId'], 'function');
});
