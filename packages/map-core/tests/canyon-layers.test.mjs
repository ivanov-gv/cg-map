import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPropertyExpression, latest} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from '../src/map-style.js';

const referenceZoom = 16;
const tileSizePixels = 512;
const metresAroundEquator = 40075016.68557849;
const scaleLatitudeDegrees = 42.7;
const groundPixelsPerMetreAtZoom16 =
  (tileSizePixels * 2 ** referenceZoom) /
  (metresAroundEquator * Math.cos((scaleLatitudeDegrees * Math.PI) / 180));
const noWidthWallPixelsAtZoom16 = 10;
const visibleWallWidthPixels = 2;
const style = mapStyle('pmtiles://archive', 'https://local.test/');
const wallLayers = style.layers.filter(layer => layer.id.startsWith('canyon-wall-'));
const rimTile = {z: referenceZoom, x: 36283, y: 24205};
const bandIndices = [0, 5];
const paintedCases = [
  {atZoom: 14, widthMetres: 26},
  {atZoom: 15, widthMetres: 26},
  {atZoom: 17, widthMetres: 5}
];
const noWidthCases = [
  {atZoom: 13, expectedPixels: 2},
  {atZoom: referenceZoom, expectedPixels: 10},
  {atZoom: 18, expectedPixels: 40},
  {atZoom: 20, expectedPixels: 160}
];

function rimWithProperties(properties) {
  return {
    type: 'LineString',
    id: 1,
    geometry: [{x: 203, y: 226}, {x: 204, y: 227}],
    properties
  };
}

function evaluatePaint(paint, paintProperty, properties, atZoom) {
  const parsed = createPropertyExpression(paint, latest['paint_line'][paintProperty]);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom: atZoom}, rimWithProperties(properties), undefined, rimTile);
}

function brightness(color) {
  return color.r + color.g + color.b;
}

function widthShareFor(bandIndex) {
  return (wallLayers.length - bandIndex) / wallLayers.length;
}

function expectedBandWidth(atZoom, widthMetres, widthShare) {
  const zoomFactor = 2 ** (atZoom - referenceZoom);
  const groundPixels = widthMetres * groundPixelsPerMetreAtZoom16 * zoomFactor * widthShare;
  const noWidthPixels = Math.max(visibleWallWidthPixels, noWidthWallPixelsAtZoom16 * zoomFactor) * widthShare;
  return Math.max(noWidthPixels, groundPixels);
}

function assertBandPixels(layer, properties, atZoom, expectedWidth, description) {
  const width = evaluatePaint(layer.paint['line-width'], 'line-width', properties, atZoom);
  const offset = evaluatePaint(layer.paint['line-offset'], 'line-offset', properties, atZoom);
  assert.ok(Math.abs(width - expectedWidth) < 1e-9, `${description} width: ${width} vs ${expectedWidth}`);
  assert.ok(Math.abs(offset - expectedWidth / 2) < 1e-9, `${description} offset: ${offset} vs ${expectedWidth / 2}`);
}

test('one ground scale gives 1.1393 px per metre at zoom 16', () => {
  const widthPixels = evaluatePaint(wallLayers[0].paint['line-width'], 'line-width', {width: 26}, referenceZoom);
  const pixelsPerMetre = widthPixels / 26;
  assert.ok(Math.abs(pixelsPerMetre - 1.1393) < 1e-4, `${pixelsPerMetre}`);
});

test('painted widths use ground distance unless the scaled no-width edge is wider', () => {
  for (const bandIndex of bandIndices) {
    const widthShare = widthShareFor(bandIndex);
    for (const {atZoom, widthMetres} of paintedCases) {
      const expectedWidth = expectedBandWidth(atZoom, widthMetres, widthShare);
      const description = `band ${bandIndex} at zoom ${atZoom}`;
      assertBandPixels(wallLayers[bandIndex], {width: widthMetres}, atZoom, expectedWidth, description);
    }
  }
});

test('an edge with no width grows like the ground and keeps a 2 px floor', () => {
  assert.ok(wallLayers.length > 0);
  for (const layer of wallLayers) {
    assert.equal(layer.filter, undefined, layer.id);
  }
  for (const bandIndex of bandIndices) {
    const widthShare = widthShareFor(bandIndex);
    for (const {atZoom, expectedPixels} of noWidthCases) {
      const description = `band ${bandIndex} at zoom ${atZoom}`;
      for (const properties of [{}, {width: 0}]) {
        assertBandPixels(wallLayers[bandIndex], properties, atZoom, expectedPixels * widthShare, description);
      }
    }
  }
});

test('a shallow edge ends lighter than a deep edge, and an unmeasured edge uses the full range', () => {
  const paint = wallLayers[0].paint['line-color'];
  const deep = brightness(evaluatePaint(paint, 'line-color', {height: 38}, referenceZoom));
  const shallow = brightness(evaluatePaint(paint, 'line-color', {height: 3}, referenceZoom));
  const unmeasured = brightness(evaluatePaint(paint, 'line-color', {}, referenceZoom));
  assert.ok(shallow > deep, `${shallow} vs ${deep}`);
  assert.equal(unmeasured, deep);
});

test('no style expression reads or matches the river property', () => {
  const sourceDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
  const runtimeFiles = fs.readdirSync(sourceDirectory).filter(name => name.endsWith('.js'));
  for (const filename of runtimeFiles) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    assert.doesNotMatch(source, /\['get',\s*'river'\]/u, filename);
  }
});
