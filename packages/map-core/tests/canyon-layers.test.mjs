import test from 'node:test';
import assert from 'node:assert/strict';
import {expression, featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from '../src/index.js';

const style = mapStyle('pmtiles://archive', 'https://local.test/');
const wallLayers = style.layers.filter(layer => layer.id.startsWith('canyon-wall-'));
const zoom = 16;
const rimTile = {z: zoom, x: 36283, y: 24205};

// Geometry-dependent paint expressions read tile coordinates and the feature's canonical tile ID.
function rimWithProperties(properties) {
  return {
    type: 'LineString',
    id: 'canyon-rim',
    geometry: [{x: 203, y: 226}, {x: 204, y: 227}],
    properties
  };
}

function wallWidthPixels(properties) {
  const parsed = expression.createExpression(wallLayers[0].paint['line-width']);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom}, rimWithProperties(properties), undefined, rimTile);
}

// An unmeasured rim is still a rim; it just has no wall to draw.
test('an edge without a height gets a rim but no wall bands', () => {
  assert.ok(wallLayers.length > 0);
  const noHeight = rimWithProperties({river: 'Example River'});
  const measured = rimWithProperties({river: 'Example River', height: 12});
  for (const layer of wallLayers) {
    const acceptsFeature = featureFilter(layer.filter).filter;
    assert.equal(acceptsFeature({zoom}, noHeight), false, layer.id);
    assert.equal(acceptsFeature({zoom}, measured), true, layer.id);
  }
});

test('two edges of one river get widths from their own heights', () => {
  const shallowWidth = wallWidthPixels({river: 'Example River', height: 10});
  const deepWidth = wallWidthPixels({river: 'Example River', height: 38});
  assert.ok(Number.isFinite(shallowWidth), String(shallowWidth));
  assert.ok(Number.isFinite(deepWidth), String(deepWidth));
  assert.ok(deepWidth > shallowWidth * 3, `${shallowWidth} vs ${deepWidth}`);
});

test('no river name appears in the canyon style', () => {
  assert.doesNotMatch(JSON.stringify(style), /Morača|Ribnica/);
});
