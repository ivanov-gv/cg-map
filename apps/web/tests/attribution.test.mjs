import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleSourceAttributions} from '../src/attribution.js';

function fakeStyle(sources, layers) {
  return {sources, layers};
}

test('visibleSourceAttributions returns attributions for visible layers in source order', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      'satellite-preview': {type: 'image'},
      'satellite-tiles': {attribution: 'Imagery: eMapa'}
    },
    [
      {id: 'background', type: 'background'},
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'satellite-preview', type: 'raster', source: 'satellite-preview', layout: {visibility: 'none'}},
      {id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles', layout: {visibility: 'none'}}
    ]
  );

  // Only basemap is visible (satellite layers are hidden)
  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});

test('visibleSourceAttributions includes satellite attribution when visible', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      'satellite-preview': {type: 'image'},
      'satellite-tiles': {attribution: 'Imagery: eMapa'}
    },
    [
      {id: 'background', type: 'background'},
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'satellite-preview', type: 'raster', source: 'satellite-preview', layout: {visibility: 'visible'}},
      {id: 'satellite-tiles', type: 'raster', source: 'satellite-tiles', layout: {visibility: 'visible'}}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM', 'Imagery: eMapa']);
});

test('visibleSourceAttributions collapses duplicate attributions', () => {
  const sharedAttr = '© Shared';
  const style = fakeStyle(
    {
      sourceA: {attribution: sharedAttr},
      sourceB: {attribution: sharedAttr}
    },
    [
      {id: 'layerA', type: 'fill', source: 'sourceA'},
      {id: 'layerB', type: 'line', source: 'sourceB'}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, [sharedAttr]);
});

test('visibleSourceAttributions skips sources with empty attribution', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      geojson: {type: 'geojson'}
    },
    [
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'markers', type: 'symbol', source: 'geojson'}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});

test('visibleSourceAttributions skips sources with no visible layers', () => {
  const style = fakeStyle(
    {
      basemap: {attribution: '© OSM'},
      hidden: {attribution: 'Hidden source'}
    },
    [
      {id: 'land', type: 'fill', source: 'basemap'},
      {id: 'hidden-layer', type: 'fill', source: 'hidden', layout: {visibility: 'none'}}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, ['© OSM']);
});
