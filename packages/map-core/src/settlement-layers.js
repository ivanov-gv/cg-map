import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

// Settlement names come from the `settlements` tile layer in both the current archive and version 5. Version 5 adds
// `place` and `population`; until data publishes them, the published `rank` keeps today's size bands.
const settlementLabelMaxZoom = 13;
const cityPopulation = 10000;
const townPopulation = 2000;
const villagePopulation = 200;
const largestTextSize = 13;
const largeTextSize = 11;
const mediumTextSize = 9;
const smallTextSize = 8;

const place = ['get', 'place'];
const rank = ['get', 'rank'];
const population = ['to-number', ['get', 'population'], 0];
const hasPlace = ['has', 'place'];
const hasRank = ['has', 'rank'];

const placeIs = value => ['==', place, value];
const rankIs = value => ['==', rank, value];
// Rank only stands in for place on features that have no place at all; a version-5 feature never reads its old rank.
const legacyRankIs = value => ['all', ['!', hasPlace], rankIs(value)];
const promotedByPopulation = threshold => ['all', hasPlace, ['>=', population, threshold]];

// Place sets the band; population promotes a place whose own number is larger than the band usually implies.
export const settlementTextSize = [
  'case',
  [
    'any',
    placeIs('city'),
    promotedByPopulation(cityPopulation),
    legacyRankIs('capital'),
    legacyRankIs('city')
  ],
  largestTextSize,
  ['any', placeIs('town'), promotedByPopulation(townPopulation), legacyRankIs('town')],
  largeTextSize,
  ['any', placeIs('village'), promotedByPopulation(villagePopulation), legacyRankIs('village')],
  mediumTextSize,
  smallTextSize
];

// A rank-only feature keeps today's label until data publishes its `place`; that case disappears with the data step.
const isLabelledSettlement = [
  'all',
  ['==', ['geometry-type'], 'Point'],
  ['has', 'name'],
  ['!=', ['get', 'name'], ''],
  ['any', hasPlace, ['all', ['!', hasPlace], hasRank]]
];

export function settlementLabelLayers() {
  return [
    inDrawingGroup('labels', {
      id: 'settlement-labels',
      type: 'symbol',
      source: 'basemap',
      'source-layer': 'settlements',
      maxzoom: settlementLabelMaxZoom,
      filter: isLabelledSettlement,
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
