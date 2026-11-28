import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mapStyle} from '../../packages/map-core/src/map-style.js';
import {selectTappedFeature} from '../../apps/web/src/selection/map-selection.js';
import {describePoint} from '../../apps/web/src/selection/point-selection.js';
import {readContractJSON} from '../contracts-root.mjs';
import {dataSourcePath} from '../data-root.mjs';

const preservedLandKinds = new Set(['country', 'context']);
const derivedWaterKinds = new Set(['ocean']);
// The shared rules are not versioned: they already offer the pending version-5 shade, while data and consumers still
// use the kinds extracted at HEAD.
const pendingEditorLandKinds = ['shade'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function greenKindsFromStyle() {
  const style = mapStyle('pmtiles://archive', 'https://local.test/');
  const landLayer = style.layers.find(layer => layer.id === 'land');
  const [operator, condition] = landLayer.paint['fill-color'];
  assert.equal(operator, 'case');
  assert.deepEqual(condition.slice(0, 2), ['in', ['get', 'kind']]);
  return condition[2][1];
}

function selectedName(kind) {
  const hit = {
    layer: {id: 'land'},
    properties: {kind, name: `Named ${kind}`},
    geometry: {coordinates: [19, 42]}
  };
  const map = {
    getLayer: () => ({}),
    queryRenderedFeatures(_point, {layers}) {
      return layers.includes('land') ? [hit] : [];
    }
  };
  const selected = [];
  selectTappedFeature(map, {point: {}, lngLat: {toArray: () => [19, 42]}}, {
    isMapReady: true,
    buildingAddresses: new Map(),
    placeHitLayers: [],
    placesById: new Map(),
    showPlace: () => {},
    showPoint: point => selected.push(point.name)
  });
  return selected;
}

test('extracted land and water kinds stay in step with validation and consumers', () => {
  const contract = readContractJSON('source-land-water.schema.json');
  const editorRules = readContractJSON('editor-layers.json');
  const landKinds = contract.$defs.landKind.enum.filter(
    kind => !preservedLandKinds.has(kind)
  );
  const waterKinds = contract.$defs.waterKind.enum;
  const editableWaterKinds = waterKinds.filter(kind => !derivedWaterKinds.has(kind));
  assert.ok(pendingEditorLandKinds.every(kind => !landKinds.includes(kind)), 'shade is not yet extracted');

  assert.deepEqual(greenKindsFromStyle().slice().sort(), landKinds.slice().sort());
  for (const [filename, expectedKinds] of [
    ['land.geojson', [...landKinds, ...pendingEditorLandKinds]],
    ['water.geojson', editableWaterKinds]
  ]) {
    const rule = editorRules.layers[filename];
    assert.deepEqual(rule.editableKinds.slice().sort(), expectedKinds.slice().sort(), filename);
    assert.equal(rule.properties.kind.required, true, filename);
    assert.deepEqual(rule.properties.kind.enum.slice().sort(), expectedKinds.slice().sort(), filename);
  }

  for (const kind of landKinds) {
    assert.deepEqual(selectedName(kind), [`Named ${kind}`], kind);
    const point = describePoint(
      {layer: {id: 'land'}, properties: {kind, name: `Named ${kind}`}},
      [19, 42]
    );
    assert.equal(point.kind, kind === 'park' ? 'Park' : 'Land', kind);
    assert.equal(point.name, `Named ${kind}`, kind);
  }

  for (const kind of waterKinds) {
    const point = describePoint(
      {layer: {id: 'water'}, properties: {kind, name: `Named ${kind}`}},
      [19, 42]
    );
    assert.equal(point.kind, 'Water', kind);
    assert.equal(point.name, `Named ${kind}`, kind);
  }
});

test('reviewed land and water omit blank names and consumers tolerate absent names', () => {
  for (const filename of ['land.geojson', 'water.geojson']) {
    const collection = readJson(dataSourcePath(filename));
    for (const feature of collection.features) {
      for (const field of ['name', 'name:en']) {
        const value = feature.properties[field];
        if (value === undefined) continue;
        assert.equal(typeof value, 'string', `${filename} ${field}`);
        assert.ok(value.trim().length > 0, `${filename} ${field} is blank`);
      }
    }
  }
  const unnamed = describePoint(
    {layer: {id: 'land'}, properties: {kind: 'meadow'}}, [19, 42]
  );
  assert.ok(unnamed.name.trim().length > 0);
});
