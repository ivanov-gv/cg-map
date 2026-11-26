import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const basemapSource = 'basemap';
const canyonSourceLayer = 'canyon_rims';
const canyonMinZoom = 13;
const wallMaxZoom = 20;
const wallReferenceZoom = 16;
const metresAroundEquator = 40075016.68557849;
const tileSizePixels = 512;
// One scale suffices across the map: cos(latitude) varies only about ±2.3% from 41.3° N to 44.1° N.
const groundPixelsPerMetreAtZoom16 = pixelsPerMetreAtZoom16((41.3 + 44.1) / 2);
// The shallowest measured edge today is 9 m, so every reviewed edge keeps the full colour range it has now.
const fullRangeDepthMetres = 9;
// An edge with no painted width keeps today's look: 10 px at zoom 16, growing like the ground. At low zoom a
// ground-scaled edge would vanish, so 2 px is the visible floor for the whole wall.
const unpaintedWallWidthPixelsAtZoom16 = 10;
const minimumVisibleWallWidthPixels = 2;
// MapLibre cannot fill a gradient across a line, so nested bands approximate one; ten is the design's minimum
// for steps that do not show.
const wallBandCount = 10;

// Ground pixels on MapLibre's 512 px tiles at a WGS84 latitude and zoom.
function groundPixels(metres, latitudeDegrees, zoom) {
  const latitudeRadians = (latitudeDegrees * Math.PI) / 180;
  return (metres * tileSizePixels * 2 ** zoom) / (metresAroundEquator * Math.cos(latitudeRadians));
}

function pixelsPerMetreAtZoom16(latitudeDegrees) {
  return groundPixels(1, latitudeDegrees, wallReferenceZoom);
}

// A stop at every whole zoom keeps both the ground width and the floor exact between stops.
function groundScaled(pixelsAtZoom16, floorShare) {
  const stops = [];
  for (let atZoom = canyonMinZoom; atZoom <= wallMaxZoom; atZoom += 1) {
    const zoomFactor = 2 ** (atZoom - wallReferenceZoom);
    const unpaintedWidthPixels = Math.max(
      minimumVisibleWallWidthPixels,
      unpaintedWallWidthPixelsAtZoom16 * zoomFactor
    );
    const floorPixels = unpaintedWidthPixels * floorShare;
    stops.push(atZoom, ['max', floorPixels, ['*', pixelsAtZoom16, zoomFactor]]);
  }
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

// Band 0 reaches the water and is darkest. A shallower edge stops partway towards that colour; without a height
// it uses the full range, as all reviewed edges did before heights were measured.
function colorForDepth(bandIndex) {
  const fullRangeColor = mixedColor(
    colors.canyonWallAtWater,
    colors.canyonWallAtRim,
    bandIndex / (wallBandCount - 1)
  );
  return [
    'case',
    ['has', 'height'],
    [
      'interpolate',
      ['linear'],
      ['number', ['get', 'height']],
      0,
      ['to-color', colors.canyonWallAtRim],
      fullRangeDepthMetres,
      ['to-color', fullRangeColor]
    ],
    ['to-color', fullRangeColor]
  ];
}

// Band 0 is widest and reaches the water; each next band is narrower and lighter, so the rim ends lightest.
// Rims run with the river on their right (relief contract), so a positive offset moves a band toward the water.
function wallBand(bandIndex) {
  const widthShare = (wallBandCount - bandIndex) / wallBandCount;
  const paintedWidthPixelsAtZoom16 = ['*', ['coalesce', ['get', 'width'], 0], groundPixelsPerMetreAtZoom16];
  return inDrawingGroup('canyon-walls', {
    id: `canyon-wall-${bandIndex}`,
    type: 'line',
    source: basemapSource,
    'source-layer': canyonSourceLayer,
    minzoom: canyonMinZoom,
    layout: {'line-cap': 'butt', 'line-join': 'round'},
    paint: {
      'line-color': colorForDepth(bandIndex),
      'line-width': groundScaled(['*', paintedWidthPixelsAtZoom16, widthShare], widthShare),
      'line-offset': groundScaled(['*', paintedWidthPixelsAtZoom16, widthShare / 2], widthShare / 2)
    }
  });
}

// A canyon wall on each bank from the water up to the rim, and the rim itself as a thin edge, not a border.
export function canyonLayers() {
  const bands = Array.from({length: wallBandCount}, (_, bandIndex) => wallBand(bandIndex));
  const rim = inDrawingGroup('canyon-rims', {
    id: 'canyon-rims',
    type: 'line',
    source: basemapSource,
    'source-layer': canyonSourceLayer,
    minzoom: canyonMinZoom,
    layout: {'line-cap': 'round', 'line-join': 'round'},
    paint: {'line-color': colors.canyonRim, 'line-width': 1}
  });
  return [...bands, rim];
}
