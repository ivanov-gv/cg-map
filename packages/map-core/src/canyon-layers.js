import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

// Penpot Core rules: the wall band is as wide as the canyon is deep, about 30 px for the Morača and 10 px for the
// Ribnica at zoom 16. Rivers without a measured width get the shallower one.
const wallWidthPixelsAtZoom16 = {Morača: 30, Ribnica: 10};
const defaultWallWidthPixelsAtZoom16 = 10;
// MapLibre cannot fill a gradient across a line, so nested bands approximate one; eight is the design's minimum
// for steps that do not show.
const wallBandCount = 10;
const canyonMinZoom = 13;

// Scales a zoom-16 pixel size so it stays the same ground distance at every zoom: twice as wide per zoom level.
function groundScaled(pixelsAtZoom16) {
  const zoomSteps = [canyonMinZoom, 16, 20];
  const stops = zoomSteps.flatMap(zoom => [zoom, ['*', pixelsAtZoom16, 2 ** (zoom - 16)]]);
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops];
}

const riverWallWidth = [
  'match',
  ['get', 'river'],
  ...Object.entries(wallWidthPixelsAtZoom16).flat(),
  defaultWallWidthPixelsAtZoom16
];

function mixedColor(fromHex, toHex, fraction) {
  const channel = (hex, index) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map(index => {
    const value = channel(fromHex, index) + (channel(toHex, index) - channel(fromHex, index)) * fraction;
    return Math.round(value).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

// Band 0 is the widest and reaches the water; each next band is narrower and lighter, so the rim ends lightest.
// Rims run with the river on their right (relief contract), so a positive offset moves a band toward the water.
function wallBand(bandIndex) {
  const widthShare = (wallBandCount - bandIndex) / wallBandCount;
  const lightness = bandIndex / (wallBandCount - 1);
  const bandWidth = groundScaled(['*', riverWallWidth, widthShare]);
  return inDrawingGroup('canyon-walls', {
    id: `canyon-wall-${bandIndex}`,
    type: 'line',
    source: 'basemap',
    'source-layer': 'canyon_rims',
    minzoom: canyonMinZoom,
    layout: {'line-cap': 'butt', 'line-join': 'round'},
    paint: {
      'line-color': mixedColor(colors.canyonWallAtWater, colors.canyonWallAtRim, lightness),
      'line-width': bandWidth,
      'line-offset': groundScaled(['*', riverWallWidth, widthShare / 2])
    }
  });
}

// A canyon wall on each bank from the water up to the rim, and the rim itself as a thin edge, not a border.
export function canyonLayers() {
  const bands = Array.from({length: wallBandCount}, (_, bandIndex) => wallBand(bandIndex));
  const rim = inDrawingGroup('canyon-rims', {
    id: 'canyon-rims',
    type: 'line',
    source: 'basemap',
    'source-layer': 'canyon_rims',
    minzoom: canyonMinZoom,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': colors.canyonRim, 'line-width': 1}
  });
  return [...bands, rim];
}
