import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

// Settlement names replace today's hardcoded city list once version 5 publishes `place` and `population` in tiles.
const settlementLabelMaxZoom = 13;
const cityPopulation = 10000;
const townPopulation = 2000;
const villagePopulation = 200;
const largestTextSize = 13;
const largeTextSize = 11;
const mediumTextSize = 9;
const smallTextSize = 8;

const place = ['get', 'place'];
const population = ['to-number', ['get', 'population'], 0];

// Place sets the band; population promotes a place whose own number is larger than the band usually implies.
export const settlementTextSize = [
  'case',
  ['any', ['==', place, 'city'], ['>=', population, cityPopulation]], largestTextSize,
  ['any', ['==', place, 'town'], ['>=', population, townPopulation]], largeTextSize,
  ['any', ['==', place, 'village'], ['>=', population, villagePopulation]], mediumTextSize,
  smallTextSize
];

// Today's tiles carry `rank` but no `place`, so requiring `place` keeps this version-5 layer from changing the map.
const isVersion5Settlement = [
  'all',
  ['==', ['geometry-type'], 'Point'],
  ['has', 'name'],
  ['!=', ['get', 'name'], ''],
  ['has', 'place']
];

export function settlementLabelLayers() {
  return [
    inDrawingGroup('labels', {
      id: 'settlement-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'settlements',
      maxzoom: settlementLabelMaxZoom,
      filter: isVersion5Settlement,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Semibold'],
        'text-size': settlementTextSize,
        'text-anchor': 'center'
      },
      paint: {
        'text-color': colors.settlementLabel,
        'text-halo-color': colors.settlementLabelHalo,
        'text-halo-width': 2
      }
    })
  ];
}
