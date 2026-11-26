import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ColorType, expression} from '@maplibre/maplibre-gl-style-spec';
import {groundPixels, mapGroundPixelsPerMetreAtZoom16} from '../src/canyon-layers.js';
import {mapStyle} from '../src/map-style.js';

const style = mapStyle('pmtiles://archive', 'https://local.test/');
const wallLayers = style.layers.filter(layer => layer.id.startsWith('canyon-wall-'));
const zoom = 16;
const rimTile = {z: zoom, x: 36283, y: 24205};

function rimWithProperties(properties) {
  return {
    type: 'LineString',
    id: 1,
    geometry: [{x: 203, y: 226}, {x: 204, y: 227}],
    properties
  };
}

function evaluateNumber(paint, properties, atZoom) {
  const parsed = expression.createExpression(paint);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom: atZoom}, rimWithProperties(properties), undefined, rimTile);
}

function evaluateColor(paint, properties) {
  const parsed = expression.createExpression(paint, ColorType);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom}, rimWithProperties(properties), undefined, rimTile);
}

function brightness(color) {
  return color.r + color.g + color.b;
}

test('one ground scale gives the expected pixels for 26 m at two zooms', () => {
  assert.equal(mapGroundPixelsPerMetreAtZoom16, groundPixels(1, 42.7, zoom));
  const paint = wallLayers[0].paint['line-width'];
  assert.equal(evaluateNumber(paint, {width: 26}, zoom), 26 * mapGroundPixelsPerMetreAtZoom16);
  assert.equal(evaluateNumber(paint, {width: 26}, zoom + 1), 52 * mapGroundPixelsPerMetreAtZoom16);
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
  const paint = wallLayers[0].paint['line-width'];
  for (const atZoom of [13, zoom, 20]) {
    assert.ok(evaluateNumber(paint, {width: 1}, atZoom) >= 10, `zoom ${atZoom}`);
    assert.ok(evaluateNumber(paint, {width: 26}, atZoom) >= 10, `zoom ${atZoom}`);
  }
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
  const sourceDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const runtimeFiles = fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.js'));
  for (const filename of runtimeFiles) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    assert.doesNotMatch(source, new RegExp(retiredRiverNames.join('|'), 'u'), filename);
    assert.doesNotMatch(source, /\['get',\s*'river'\]/, filename);
  }
});
