import test from 'node:test';
import assert from 'node:assert/strict';
import {featureCapabilities, operationProblem, propertyProblem} from '../src/layers/shared/layer-rules.js';
import {collectionOf} from '../src/source-data/source-records.js';

const levels = new Set([1, 2, 3]);
const problemOf = (value, rule, previous) =>
  propertyProblem({value}, {value: rule}, levels, previous === undefined ? {} : {value: previous});
const accepts = (rule, ...values) => {
  for (const value of values) assert.equal(problemOf(value, rule), null, JSON.stringify(value));
};
const refuses = (rule, ...values) => {
  for (const value of values) assert.notEqual(problemOf(value, rule), null, JSON.stringify(value));
};

test('whole numbers, yes or no and lists are judged by their rule', () => {
  accepts({type: 'integer', minimum: 0, maximum: 40, multipleOf: 20}, 0, 20, 40);
  refuses({type: 'integer', minimum: 0, maximum: 40, multipleOf: 20}, 10, 60, '20', 1.5);
  accepts({type: 'boolean'}, true, false);
  refuses({type: 'boolean'}, 'true');
  accepts({type: 'list', maxLength: 4}, ['1', '2']);
  refuses({type: 'list', maxLength: 4}, '1', [1], ['12345']);
});

test('a junction or road is named by its OpenStreetMap number or by the ID the editor gave it', () => {
  const localId = 'local:33333333-3333-4333-8333-333333333333';
  accepts({type: 'identifier'}, 12, localId);
  refuses({type: 'identifier'}, 'node/12', 1.5, 'local:road');
  accepts({type: 'identifiers'}, [12, localId]);
  refuses({type: 'identifiers'}, 12, ['12']);
});

const rules = {
  version: 2,
  localPlaceSource: 'Local correction',
  layers: {
    'land.geojson': {
      operations: ['add', 'modify', 'delete'],
      geometries: ['Polygon'],
      editableKinds: ['park'],
      limitedKinds: {country: {operations: ['modify'], geometry: false, properties: ['name']}},
      properties: {kind: {required: true}, name: {maxLength: 20}, source: {addOnly: true}}
    }
  }
};
const square = [[19, 42], [19.001, 42], [19.001, 42.001], [19, 42]];
const land = (properties, coordinates = [square]) => ({type: 'Feature', properties, geometry: {type: 'Polygon', coordinates}});
const modify = (before, after) =>
  operationProblem({filename: 'land.geojson', operation: 'modify', reference: {featureIndex: 0}, before, after}, rules, levels);

test('a kind that only frames the map allows what its limits say', () => {
  const country = land({kind: 'country', name: 'Old'});
  assert.equal(modify(country, land({kind: 'country', name: 'New'})), null);
  const moved = square.map(([longitude, latitude]) => [longitude + 0.1, latitude]);
  assert.match(modify(country, land({kind: 'country', name: 'Old'}, [moved])), /geometry is not editable/);
  assert.equal(featureCapabilities(country, rules.layers['land.geojson']).canReshape, false);
  assert.equal(featureCapabilities(land({kind: 'park'}), rules.layers['land.geojson']).canReshape, true);
});

test('a fact that is only stated when an object is added stays as it is', () => {
  const park = land({kind: 'park', source: 'survey'});
  assert.match(modify(park, land({kind: 'park', source: 'guess'})), /source is not editable/);
});

test('records without a place are read as objects, and other files as they are', () => {
  const read = collectionOf('transit-routes.json', {entitySchemaVersion: 1, routes: [{number: '1'}]});
  assert.deepEqual(read.features, [{type: 'Feature', geometry: null, properties: {number: '1'}}]);
  assert.deepEqual(collectionOf('turn-restrictions.json', {}).features, []);
  const collection = {type: 'FeatureCollection', features: []};
  assert.equal(collectionOf('roads.geojson', collection), collection);
});
