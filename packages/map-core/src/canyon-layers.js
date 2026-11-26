import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const scaleReferenceZoom = 16;
// One scale for all rims: today's two typical widths divided by their median heights give 2 px/m and 1 px/m at
// zoom 16. One scale cannot match both, so use their midpoint.
const scaledPixelsPerMetreAtZoom16 = (2 + 1) / 2;
// MapLibre cannot fill a gradient across a line, so nested bands approximate one; ten is the design's minimum
// for steps that do not show.
const wallBandCount = 10;
const canyonMinZoom = 13;
const groundMaxZoom = 20;
// Consecutive one-zoom stops let MapLibre's exponential interpolation double the pixel width at every zoom level.
const groundZoomStops = Array.from(
  {length: groundMaxZoom - canyonMinZoom + 1},
  (_, offset) => canyonMinZoom + offset
);
const hasMeasuredHeight = ['has', 'height'];

// Returns a line-width expression; doubling the pixel width per zoom level keeps the same ground scale.
function scaledWidthPixels(metres) {
  const stops = groundZoomStops.flatMap(zoom => [
    zoom,
    ['*', metres, scaledPixelsPerMetreAtZoom16, 2 ** (zoom - scaleReferenceZoom)]
  ]);
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops];
}

function mixedColor(fromHex, toHex, fraction) {
  const fromChannels = colorChannels(fromHex);
  const toChannels = colorChannels(toHex);
  const mixed = fromChannels.map((fromChannel, index) => {
    const value = fromChannel + (toChannels[index] - fromChannel) * fraction;
    return Math.round(value).toString(16).padStart(2, '0');
  });
  return `#${mixed.join('')}`;
}

// Band 0 is the widest and reaches the water; each next band is narrower and lighter, so the rim ends lightest.
// Rims run with the river on their right (relief contract), so a positive offset moves a band toward the water.
function wallBand(bandIndex) {
  const widthShare = (wallBandCount - bandIndex) / wallBandCount;
  const lightness = bandIndex / (wallBandCount - 1);
  const rimHeight = ['get', 'height'];
  return inDrawingGroup('canyon-walls', {
    id: `canyon-wall-${bandIndex}`,
    type: 'line',
    source: 'basemap',
    'source-layer': 'canyon_rims',
    minzoom: canyonMinZoom,
    filter: hasMeasuredHeight,
    layout: {'line-cap': 'butt', 'line-join': 'round'},
    paint: {
      'line-color': mixedColor(colors.canyonWallAtWater, colors.canyonWallAtRim, lightness),
      'line-width': scaledWidthPixels(['*', rimHeight, widthShare]),
      'line-offset': scaledWidthPixels(['*', rimHeight, widthShare / 2])
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
