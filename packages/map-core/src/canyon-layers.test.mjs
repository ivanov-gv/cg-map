import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ColorType, expression} from '@maplibre/maplibre-gl-style-spec';
import * as canyon from './canyon-layers.js';
import {mapStyle} from './map-style.js';

const {groundPixels, pixelsPerMetreAtZoom16, wallPixelsPerMetreStateKey} = canyon;
const style = mapStyle('pmtiles://archive', 'https://local.test/');
const wallLayers = style.layers.filter(layer => layer.id.startsWith('canyon-wall-'));
const zoom = 16;
const latitude = 42.44;
const rimTile = {z: zoom, x: 36283, y: 24205};

function rimWithProperties(properties) {
  return {
    type: 'LineString',
    id: 1,
    geometry: [{x: 203, y: 226}, {x: 204, y: 227}],
    properties
  };
}

function evaluateNumber(paint, properties, atZoom, featureState) {
  const parsed = expression.createExpression(paint);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom: atZoom}, rimWithProperties(properties), featureState, rimTile);
}

function evaluateColor(paint, properties) {
  const parsed = expression.createExpression(paint, ColorType);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom}, rimWithProperties(properties), undefined, rimTile);
}

function brightness(color) {
  return color.r + color.g + color.b;
}

test('wall width comes from the edge width in ground metres at two zooms', () => {
  const properties = {width: 26};
  const featureState = {[wallPixelsPerMetreStateKey]: pixelsPerMetreAtZoom16(latitude)};
  const paint = wallLayers[0].paint['line-width'];
  assert.equal(evaluateNumber(paint, properties, zoom, featureState), groundPixels(26, latitude, zoom));
  assert.equal(evaluateNumber(paint, properties, zoom + 1, featureState), groundPixels(26, latitude, zoom + 1));
});

test('an edge without width draws a fixed 10 px wall band from zoom 13 to 20', () => {
  assert.ok(wallLayers.length > 0);
  for (const layer of wallLayers) {
    assert.equal(layer.filter, undefined, layer.id);
  }
  const paint = wallLayers[0].paint['line-width'];
  for (const atZoom of [13, zoom, 20]) {
    assert.equal(evaluateNumber(paint, {}, atZoom), 10, `absent width at zoom ${atZoom}`);
    assert.equal(evaluateNumber(paint, {width: 0}, atZoom), 10, `zero width at zoom ${atZoom}`);
  }
  assert.equal(evaluateNumber(wallLayers[0].paint['line-offset'], {}, zoom), 5);
});

test('a painted width never draws a narrower band than an empty width', () => {
  const featureState = {[wallPixelsPerMetreStateKey]: pixelsPerMetreAtZoom16(latitude)};
  const paint = wallLayers[0].paint['line-width'];
  for (const atZoom of [13, zoom, 20]) {
    assert.ok(evaluateNumber(paint, {width: 1}, atZoom, featureState) >= 10, `zoom ${atZoom}`);
    assert.ok(evaluateNumber(paint, {width: 26}, atZoom, featureState) >= 10, `zoom ${atZoom}`);
  }
});

test('each rim gets its ground scale from all its tile segments and teardown removes the listener', () => {
  let availableRims = [
    {id: 7, geometry: {coordinates: [[19.3, 42.4], [19.31, 42.5]]}},
    {id: 8, geometry: {coordinates: [[19.2, 42.3]]}}
  ];
  const queries = [];
  const stateCalls = [];
  let sourceListener;
  let removedListener;
  const map = {
    on: (event, listener) => {
      assert.equal(event, 'sourcedata');
      sourceListener = listener;
    },
    off: (event, listener) => {
      assert.equal(event, 'sourcedata');
      removedListener = listener;
    },
    querySourceFeatures: (sourceId, options) => {
      queries.push({sourceId, options});
      return availableRims;
    },
    setFeatureState: (feature, state) => stateCalls.push({feature, state})
  };
  const stop = canyon.installCanyonWallScales(map);
  assert.deepEqual(queries[0], {sourceId: 'basemap', options: {sourceLayer: 'canyon_rims'}});
  assert.equal(stateCalls.length, 2);
  assert.deepEqual(stateCalls[0].feature, {source: 'basemap', sourceLayer: 'canyon_rims', id: 7});
  assert.equal(stateCalls[0].state[wallPixelsPerMetreStateKey], pixelsPerMetreAtZoom16(42.45));
  assert.equal(stateCalls[1].state[wallPixelsPerMetreStateKey], pixelsPerMetreAtZoom16(42.3));

  availableRims = [...availableRims, {id: 7, geometry: {coordinates: [[19.32, 42.6]]}}];
  sourceListener({sourceId: 'basemap'});
  assert.equal(queries.length, 2);
  assert.equal(stateCalls.length, 3);
  assert.equal(stateCalls[2].feature.id, 7);
  assert.equal(stateCalls[2].state[wallPixelsPerMetreStateKey], pixelsPerMetreAtZoom16(42.5));
  sourceListener({sourceId: 'other'});
  assert.equal(queries.length, 2);
  sourceListener({sourceId: 'basemap'});
  assert.equal(stateCalls.length, 3);
  stop();
  assert.equal(removedListener, sourceListener);
});

test('a shallow edge ends lighter than a deep edge, and an unmeasured edge uses the full range', () => {
  const paint = wallLayers[0].paint['line-color'];
  const deep = brightness(evaluateColor(paint, {height: 38}));
  const shallow = brightness(evaluateColor(paint, {height: 3}));
  const unmeasured = brightness(evaluateColor(paint, {}));
  assert.ok(shallow > deep, `${shallow} vs ${deep}`);
  assert.equal(unmeasured, deep);
});

test('no river name or river-keyed style rule remains in the core runtime', () => {
  // Escaped so the assertion does not reintroduce the names it forbids.
  const retiredRiverNames = ['Mora\\u010da', 'Rib\\u006eica'];
  const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
  const runtimeFiles = fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.js'));
  for (const filename of runtimeFiles) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    assert.doesNotMatch(source, new RegExp(retiredRiverNames.join('|'), 'u'), filename);
    assert.doesNotMatch(source, /\['get',\s*'river'\]/, filename);
  }
});
