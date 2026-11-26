import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const earthEquatorialCircumferenceMetres = 40075016.686;
const maplibreTileSizePixels = 512;
const groundTruthZoom = 16;
const metresPerLatitudeDegree = earthEquatorialCircumferenceMetres / 360;
// MapLibre's distance expression measures from the evaluated feature, so a rim's distance to the equator gives its
// latitude without adding a field to the tiles.
const equator = {type: 'LineString', coordinates: [[-180, 0], [0, 0], [180, 0]]};
const latitudeDegrees = ['/', ['distance', equator], metresPerLatitudeDegree];
// At zoom z one pixel covers circumference × cos(latitude) / (512 × 2^z) metres on the ground.
const pixelsPerGroundMetreAtZoom16 = [
  '/',
  maplibreTileSizePixels * 2 ** groundTruthZoom,
  ['*', earthEquatorialCircumferenceMetres, ['cos', ['*', latitudeDegrees, Math.PI / 180]]]
];
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

// Returns a line-width expression; doubling the pixel width per zoom level keeps the ground width unchanged.
function groundWidthPixels(metres) {
  const stops = groundZoomStops.flatMap(zoom => [
    zoom,
    ['*', metres, pixelsPerGroundMetreAtZoom16, 2 ** (zoom - groundTruthZoom)]
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
      'line-width': groundWidthPixels(['*', rimHeight, widthShare]),
      'line-offset': groundWidthPixels(['*', rimHeight, widthShare / 2])
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
