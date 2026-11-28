import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pinnedContractsRoot} from '../../../tests/pinned-contracts.mjs';
import {featureCapabilities, operationProblem, propertyProblem, rulesForBundleVersion} from './layer-rules.js';

const contracts = JSON.parse(readFileSync(path.join(pinnedContractsRoot, 'editor-layers.json'), 'utf8'));
const levels = new Set([1, 2, 3]);
const square = [[19, 42], [19.001, 42], [19.001, 42.001], [19, 42]];
const moved = square.map(([longitude, latitude]) => [longitude + 0.001, latitude]);
const surfaceFeature = (properties, coordinates = [square]) => ({
  type: 'Feature',
  properties,
  geometry: {type: 'Polygon', coordinates}
});

test('bundle rules come from the verified version, leaving released rules alone', () => {
  const released = rulesForBundleVersion(contracts, 3);
  assert.equal(released.bundleVersion, 3);
  assert.equal(released.layers['land.geojson'], contracts.layers['land.geojson']);
  assert.equal(rulesForBundleVersion(contracts, undefined), contracts);

  const version5 = rulesForBundleVersion(contracts, 5);
  assert.equal(version5.bundleVersion, 5);
  assert.equal(version5.version, 2);
  assert.deepEqual(Object.keys(version5.layers), [
    'surface.geojson',
    'roads.geojson',
    'bridges.geojson',
    'railways.geojson',
    'buildings.geojson',
    'places.geojson',
    'settlements.geojson',
    'relief.geojson',
    'canyon-rims.geojson',
    'transport-stops.geojson',
    'transit-network.json',
    'transit-routes.json'
  ]);
  assert.equal(version5.layers['land.geojson'], undefined);
  assert.throws(() => rulesForBundleVersion(contracts, 6), /do not cover bundle version 6/);
});

test('a stored point and a stored line are judged by their own WGS84 type', () => {
  const {properties} = rulesForBundleVersion(contracts, 5).layers['surface.geojson'];
  const withKind = values => ({kind: 'park', ...values});
  assert.equal(propertyProblem(withKind({labelPoint: [19.2, 42.4]}), properties, levels), null);
  for (const bad of [[19.2], '19.2,42.4', [19.2, null], [200, 42.4]]) {
    assert.match(propertyProblem(withKind({labelPoint: bad}), properties, levels), /WGS84 longitude and latitude/);
  }
  assert.equal(propertyProblem(withKind({labelLine: [[19.2, 42.4], [19.3, 42.5]]}), properties, levels), null);
  for (const bad of [[], [[19.2]], [19.2, 42.4], [[200, 42.4], [19.3, 42.5]]]) {
    assert.match(propertyProblem(withKind({labelLine: bad}), properties, levels), /at least two WGS84 positions/);
  }
});

test('a limit names the actual maximum it refuses, as the importer does', () => {
  const inclusive = {value: {type: 'number', minimum: 0, maximum: 5}};
  assert.equal(propertyProblem({value: 5}, inclusive, levels), null);
  assert.match(propertyProblem({value: 6}, inclusive, levels), /value is above 5/);
  const exclusive = {value: {type: 'number', minimum: 0, exclusiveMaximum: 360}};
  assert.equal(propertyProblem({value: 359.9}, exclusive, levels), null);
  assert.match(propertyProblem({value: 360}, exclusive, levels), /value must be below 360/);
});

test('facts required or allowed for one kind are not demanded of another', () => {
  const {properties} = rulesForBundleVersion(contracts, 5).layers['surface.geojson'];
  assert.match(propertyProblem({kind: 'context'}, properties, levels), /name is required/);
  assert.equal(propertyProblem({kind: 'park'}, properties, levels), null);
  assert.equal(propertyProblem({kind: 'park', destination: true}, properties, levels), null);
  assert.match(propertyProblem({kind: 'lake', destination: true}, properties, levels), /not allowed for lake/);
  assert.match(propertyProblem({kind: 'lake', iconPoint: [19.2, 42.4]}, properties, levels), /poiKind is required with iconPoint/);
  assert.equal(
    propertyProblem({kind: 'lake', iconPoint: [19.2, 42.4], poiKind: 'cafe'}, properties, levels),
    null
  );
});

test('a frame kind of the surface keeps its stored outline editable and its other facts locked', () => {
  const rules = rulesForBundleVersion(contracts, 5);
  const rule = rules.layers['surface.geojson'];
  const before = surfaceFeature({kind: 'municipality', name: 'West', labelPoint: [19, 42]});
  const after = surfaceFeature({kind: 'municipality', name: 'West', labelPoint: [19, 42]}, [moved]);
  const operation = {filename: 'surface.geojson', operation: 'modify', reference: {key: '0'}, before, after};
  assert.equal(operationProblem(operation, rules, levels), null);
  assert.equal(featureCapabilities(before, rule, rules.bundleVersion).canReshape, true);
  assert.equal(featureCapabilities(before, rule, rules.bundleVersion).canDelete, false);

  const changedFact = surfaceFeature({kind: 'municipality', name: 'West', labelPoint: [19, 42], destination: true});
  assert.match(
    operationProblem({...operation, after: changedFact}, rules, levels),
    /destination is not editable/
  );
  const relabelled = surfaceFeature({kind: 'municipality', name: 'West', labelPoint: [19.1, 42]});
  assert.equal(operationProblem({...operation, after: relabelled}, rules, levels), null);

  const neighbour = surfaceFeature({kind: 'context', name: 'Neighbour'});
  const movedNeighbour = surfaceFeature({kind: 'context', name: 'Neighbour'}, [moved]);
  assert.equal(operationProblem({...operation, before: neighbour, after: movedNeighbour}, rules, levels), null);
  assert.match(
    operationProblem(
      {
        ...operation,
        before: neighbour,
        after: {...movedNeighbour, properties: {...movedNeighbour.properties, population: 10}}
      },
      rules,
      levels
    ),
    /population is not editable/
  );

  const sea = surfaceFeature({kind: 'sea'});
  const movedSea = surfaceFeature({kind: 'sea'}, [moved]);
  assert.equal(
    operationProblem({...operation, before: sea, after: movedSea}, rules, levels),
    null
  );
});
