import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFooterVersionText, visibleSourceAttributions} from '../src/attribution.js';

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
  const sharedAttribution = '© Shared';
  const style = fakeStyle(
    {
      sourceA: {attribution: sharedAttribution},
      sourceB: {attribution: sharedAttribution}
    },
    [
      {id: 'layerA', type: 'fill', source: 'sourceA'},
      {id: 'layerB', type: 'line', source: 'sourceB'}
    ]
  );

  const result = visibleSourceAttributions(style);
  assert.deepEqual(result, [sharedAttribution]);
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

test('buildFooterVersionText includes the app name, version and short commit', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: 'a1b2c3d'};

  assert.equal(buildFooterVersionText(build), 'Kompas 0.1.0 · a1b2c3d · ');
});

test('buildFooterVersionText omits the commit when the build does not know one', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: null};

  assert.equal(buildFooterVersionText(build), 'Kompas 0.1.0 · ');
});

test('buildFooterVersionText keeps the version but drops the commit in the compact form', () => {
  const build = {name: 'Kompas', version: '0.1.0', commit: 'a1b2c3d'};

  assert.equal(buildFooterVersionText(build, {compact: true}), 'Kompas 0.1.0 · ');
});
