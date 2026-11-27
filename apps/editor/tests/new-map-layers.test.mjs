import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import {availableLayers, editorLayers} from '../src/layers/shared/editor-layers.js';
import {bridgeBehaviors} from '../src/layers/roads/layer-bridges.js';
import {drawChoicesOf} from '../src/layers/shared/layer-behaviors.js';
import {kindLabel, objectName} from '../src/layers/shared/object-names.js';
import {railwayBehaviors} from '../src/layers/transport/layer-railways.js';
import {bundleFilesByVersion} from '../src/source-data/source-bundle.js';

const readContract = name =>
  JSON.parse(fileSystem.readFileSync(new URL(import.meta.resolve(`@ivanov-gv/map-contracts/${name}`))));
const pinnedRules = readContract('editor-layers.json');
const fixtureRules = JSON.parse(fileSystem.readFileSync(new URL('fixtures/editor-layers.json', import.meta.url)));
const layerOf = id => editorLayers.find(layer => layer.id === id);

test('the pinned rules cover both new files and the test fixture matches them exactly', () => {
  for (const filename of ['bridges.geojson', 'railways.geojson']) {
    assert.deepEqual(fixtureRules.layers[filename], pinnedRules.layers[filename]);
    assert.deepEqual(pinnedRules.layers[filename].operations, ['add', 'modify', 'delete']);
  }
  assert.deepEqual(pinnedRules.layers['bridges.geojson'].geometries, ['Polygon']);
  assert.deepEqual(pinnedRules.layers['railways.geojson'].geometries, ['Point', 'LineString', 'Polygon']);
});

test('bridge outlines are edited with roads, and railways have their own Transport layer in version 4', () => {
  assert.ok(layerOf('roads').files.includes('bridges.geojson'));
  assert.equal(layerOf('railways').group, 'Transport');
  assert.deepEqual(layerOf('railways').files, ['railways.geojson']);
  const layerIdsOf = version => availableLayers(bundleFilesByVersion[version]).map(({id}) => id);
  assert.equal(layerIdsOf(3).includes('railways'), false, 'an older bundle keeps its ten layers');
  assert.ok(layerIdsOf(4).includes('railways'));
});

test('a new bridge or railway states only kinds and origins the rules allow', () => {
  const choices = [
    ...drawChoicesOf(layerOf('roads'), fixtureRules),
    ...drawChoicesOf(layerOf('railways'), fixtureRules)
  ].filter(({filename}) => ['bridges.geojson', 'railways.geojson'].includes(filename));
  assert.deepEqual(choices.map(({label}) => label), [
    'Draw bridge',
    'Add station',
    'Add halt',
    'Draw rail',
    'Draw disused rail',
    'Draw platform'
  ]);
  for (const choice of choices) {
    const rule = pinnedRules.layers[choice.filename];
    assert.ok(rule.operations.includes('add'));
    assert.ok(rule.geometries.includes(choice.shape));
    assert.ok(rule.properties.kind.enum.includes(choice.properties.kind));
    for (const [name, value] of Object.entries(choice.properties)) {
      assert.ok(
        name === 'kind' || (rule.properties[name].addOnly && rule.properties[name].enum.includes(value)),
        `${choice.filename} ${name} must be an allowed addOnly field`
      );
    }
  }
});

test('bridge and railway objects get names that say what they are', () => {
  assert.equal(kindLabel('bridges.geojson'), 'Bridge');
  assert.equal(kindLabel('railways.geojson'), 'Railway');
  assert.equal(objectName({properties: {name: 'Most'}}, 'bridges.geojson'), 'Most');
  assert.equal(bridgeBehaviors['bridges.geojson'].title({properties: {kind: 'bridge'}}), 'Bridge');
  assert.equal(railwayBehaviors['railways.geojson'].title({properties: {kind: 'station'}}), 'Station');
});
