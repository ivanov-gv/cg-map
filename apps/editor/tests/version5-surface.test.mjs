import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pinnedContractsRoot} from './pinned-contracts.mjs';
import {bundleFilesByVersion} from '../src/source-data/source-bundle.js';
import {availableLayers, entriesForLayer} from '../src/layers/shared/editor-layers.js';
import {behaviorOf, drawChoicesOf} from '../src/layers/shared/layer-behaviors.js';
import {routeBehaviors} from '../src/layers/routes/layer-routes.js';
import {rulesForBundleVersion} from '../src/layers/shared/layer-rules.js';
import {
  linkedSelection,
  municipalityCompanions,
  movedStoredValue,
  shadeForArea,
  shadeProblem,
  storedPositionFeatures
} from '../src/layers/shared/surface-edits.js';
import {
  registerVersion5Behaviors,
  version5StoredPositions,
  version5SurfaceBehaviorsByLayer
} from '../src/layers/shared/version5-behaviors.js';

registerVersion5Behaviors();

const surfaceFile = 'surface.geojson';
const square = [[19, 42], [19.001, 42], [19.001, 42.001], [19, 42.001], [19, 42]];
const feature = (properties, geometry) => ({type: 'Feature', properties, geometry});
const entry = (key, properties, geometry) => ({filename: surfaceFile, key, feature: feature(properties, geometry)});
const area = entry('0', {kind: 'park', entityId: 'way/50'}, {type: 'Polygon', coordinates: [square]});
const contextOf = (...entries) => ({entriesOf: () => entries});
const rounded = value =>
  Array.isArray(value[0]) ? value.map(point => point.map(coordinate => Number(coordinate.toFixed(10)))) : value;

function editOf(current, entries = [current]) {
  const properties = [];
  const problems = [];
  let replaced = null;
  return {
    key: current.key,
    context: contextOf(...entries),
    typedFeature: () => current.feature,
    setProperties: values => properties.push(values),
    showProblem: message => problems.push(message),
    replaceWith: (edits, message) => {
      replaced = {edits, message};
    },
    isOpen: () => true,
    properties,
    problems,
    get replaced() {
      return replaced;
    }
  };
}

test('a shade belongs to one green area and stays inside it', () => {
  const seed = shadeForArea(area);
  assert.equal(seed.properties.kind, 'shade');
  assert.equal(seed.properties.greenAreaEntityId, 'way/50');
  assert.equal(seed.geometry.type, 'MultiPolygon');
  assert.equal(shadeProblem({key: 'local:shade', feature: seed}, contextOf(area, entry('local:shade', seed.properties, seed.geometry))), null);

  const outside = feature(seed.properties, {type: 'MultiPolygon', coordinates: [[square.map(([x, y]) => [x + 0.01, y])]]});
  const badContext = contextOf(area, entry('local:shade', outside.properties, outside.geometry));
  assert.match(shadeProblem({key: 'local:shade', feature: outside}, badContext), /inside its green area/);

  const polygonInstead = feature(seed.properties, {type: 'Polygon', coordinates: [square]});
  assert.match(shadeProblem({key: 'local:shade', feature: polygonInstead}, contextOf(area)), /MultiPolygon/);
  const unlinked = feature({...seed.properties, greenAreaEntityId: 'way/99'}, seed.geometry);
  assert.match(shadeProblem({key: 'local:shade', feature: unlinked}, contextOf(area)), /name a green area/);
  const duplicate = entry('1', seed.properties, seed.geometry);
  assert.match(
    shadeProblem({key: 'local:shade', feature: seed}, contextOf(area, duplicate)),
    /already has a shade/
  );
  assert.equal(shadeForArea(entry('0', {kind: 'sea'}, {type: 'Polygon', coordinates: [square]})), null);
});

test('adding a shade picks its area and seeds a valid shape in one edit', async () => {
  const behavior = version5SurfaceBehaviorsByLayer.green[surfaceFile];
  const edit = editOf(area);
  const addShade = behavior.tools(area.feature, edit).find(({label}) => label === 'Add shade');
  assert.ok(addShade, 'the green layer offers a shade');
  addShade.run();
  assert.equal(edit.problems.length, 0);
  assert.equal(edit.replaced.edits[0].filename, surfaceFile);
  const added = edit.replaced.edits[0].after;
  assert.equal(added.properties.greenAreaEntityId, 'way/50');
  assert.equal(shadeProblem({key: edit.replaced.edits[0].key, feature: added}, edit.context), null);
});

test('clicking a water area with a river link opens the river card', () => {
  const river = entry('1', {kind: 'river', entityId: 'way/61'}, {type: 'LineString', coordinates: [[19, 42], [19.1, 42.1]]});
  const lake = entry('0', {kind: 'lake', riverEntityId: 'way/61'}, {type: 'Polygon', coordinates: [square]});
  assert.equal(linkedSelection(lake, contextOf(lake, river)), river);
  const unlinked = {...lake, feature: {...lake.feature, properties: {kind: 'lake'}}};
  assert.equal(linkedSelection(unlinked, contextOf(unlinked, river)), unlinked);
  const land = entry('2', {kind: 'park', riverEntityId: 'way/61'}, {type: 'Polygon', coordinates: [square]});
  assert.equal(linkedSelection(land, contextOf(land, river)), land);
});

test('an edit of a shared municipal edge moves every polygon that holds it', () => {
  const westRing = [[0, -6], [0, 0], [0, 6], [-6, 6], [-6, -6]];
  const eastRing = [[0, -6], [6, -6], [6, 6], [0, 6], [0, 0]];
  const west = entry('0', {kind: 'municipality', entityId: 'relation/90'}, {type: 'Polygon', coordinates: [westRing]});
  const east = entry('1', {kind: 'municipality', entityId: 'relation/91'}, {type: 'Polygon', coordinates: [eastRing]});
  const moved = {...west, feature: {...west.feature, geometry: {type: 'Polygon', coordinates: [[
    [0, -6], [2, 0], [0, 6], [-6, 6], [-6, -6]
  ]]}}};
  const context = contextOf(west, east);
  const edits = municipalityCompanions({key: moved.key, feature: moved.feature, before: west.feature}, context);
  assert.deepEqual(edits.map(({key}) => key), ['1']);
  assert.ok(JSON.stringify(edits[0].after.geometry.coordinates).includes('[2,0]'));
  assert.equal(municipalityCompanions({key: moved.key, feature: moved.feature, before: null}, context).length, 0);
});

test('stored positions are shown where stored and moved only when picked', async () => {
  const labelled = entry('0', {
    labelPoint: [19.2, 42.4],
    labelLine: [[19.2, 42.4], [19.3, 42.4]],
    iconPoint: [19.4, 42.4]
  }, {type: 'Polygon', coordinates: [square]});
  const stored = version5StoredPositions([labelled, area]);
  assert.deepEqual(stored.map(({properties}) => properties.field), ['labelPoint', 'labelLine', 'iconPoint']);
  assert.deepEqual(stored.map(({geometry}) => geometry.type), ['Point', 'LineString', 'Point']);
  assert.deepEqual(storedPositionFeatures([labelled]), stored);

  const behavior = version5SurfaceBehaviorsByLayer.green[surfaceFile];
  const edit = editOf(labelled);
  edit.context.pickPoint = async () => [19.5, 42.5];
  const tools = behavior.tools(labelled.feature, edit);
  for (const {run} of tools.filter(({label}) => label.includes('label') || label.includes('icon'))) {
    await run();
  }
  assert.deepEqual(edit.properties.slice(0, 1).concat(edit.properties.slice(2)), [
    {labelPoint: [19.5, 42.5]},
    {iconPoint: [19.5, 42.5]}
  ]);
  assert.deepEqual(rounded(edit.properties[1].labelLine), [
    [19.45, 42.5],
    [19.55, 42.5]
  ]);
  assert.deepEqual(rounded(movedStoredValue('labelLine', labelled.feature.properties.labelLine, [19.5, 42.5])), [
    [19.45, 42.5],
    [19.55, 42.5]
  ]);
});

test('version 5 uses its own layer kinds, draw choices and behavior', () => {
  const version5 = rulesForBundleVersion(
    JSON.parse(readFileSync(path.join(pinnedContractsRoot, 'editor-layers.json'), 'utf8')),
    5
  );
  const released = rulesForBundleVersion(
    JSON.parse(readFileSync(path.join(pinnedContractsRoot, 'editor-layers.json'), 'utf8')),
    3
  );
  const layers5 = availableLayers(bundleFilesByVersion[5], 5);
  assert.equal(layers5.find(({id}) => id === 'addresses'), undefined);
  assert.deepEqual(layers5.find(({id}) => id === 'green').files, [surfaceFile]);
  assert.deepEqual(layers5.find(({id}) => id === 'relief').files, ['relief.geojson', 'canyon-rims.geojson']);
  const layers3 = availableLayers(bundleFilesByVersion[3], 3);
  assert.deepEqual(layers3.find(({id}) => id === 'green').files, ['land.geojson', 'protected-areas.geojson']);

  const entries = [
    area,
    entry('1', {kind: 'municipality'}, {type: 'Polygon', coordinates: [square]}),
    entry('2', {kind: 'lake'}, {type: 'Polygon', coordinates: [square]})
  ];
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'green'), entries), [area]);
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'settlements'), entries), [entries[1]]);
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'water'), entries), [entries[2]]);
  assert.deepEqual(entriesForLayer(layers3.find(({id}) => id === 'green'), entries), entries);

  assert.equal(drawChoicesOf(layers5.find(({id}) => id === 'green'), version5)[0].filename, surfaceFile);
  assert.equal(drawChoicesOf(layers3.find(({id}) => id === 'green'), released)[0].filename, 'land.geojson');

  const surfaceBehavior = behaviorOf(surfaceFile, 'green', 5);
  assert.equal(surfaceBehavior.kind({properties: {kind: 'protected-area'}}), 'protected area');
  assert.equal(behaviorOf(surfaceFile, 'green', 5).tools(area.feature, editOf(area)).length >= 1, true);
  assert.deepEqual(behaviorOf('water.geojson', 'water', 5).tools(area.feature, editOf(area)), []);
  assert.equal(behaviorOf(surfaceFile, null, 3).tools(area.feature, editOf(area)).length, 0);
});

test('version 5 keeps the released route behavior, including the phone limit', () => {
  const route = routeBehaviors['transit-routes.json'];
  const version5Route = behaviorOf('transit-routes.json', 'routes', 5);
  assert.equal(version5Route.isViewOnly({isPhone: () => true}), true);
  assert.equal(version5Route.isViewOnly({isPhone: () => false}), false);
  assert.equal(version5Route.problem, route.problem);
  assert.equal(version5Route.renderExtras, route.renderExtras);
  assert.equal(version5Route.companionEdits, route.companionEdits);
});
