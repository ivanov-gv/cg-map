import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const basemapSource = 'basemap';
const canyonSourceLayer = 'canyon_rims';
const canyonMinZoom = 13;
const wallMaxZoom = 20;
const wallReferenceZoom = 16;
// MapLibre's Web Mercator tiles are 512 px: at Podgorica's latitude 26 m is about 30 px and 9 m about 10 px at zoom 16.
const metresAroundEquator = 40075016.68557849;
const tileSizePixels = 512;
const fallbackLatitudeDegrees = 42.442;
// The shallowest measured edge today is 9 m, so every reviewed edge keeps the full colour range it has now.
const fullRangeDepthMetres = 9;
export const wallPixelsPerMetreStateKey = 'canyonWallPixelsPerMetre';
// An unpainted edge must still read as a canyon: 10 px is visible from zoom 13 to 20 and matches the narrowest
// wall in today's reviewed style at zoom 16.
const minimumWallWidthPixels = 10;
// MapLibre cannot fill a gradient across a line, so nested bands approximate one; ten is the design's minimum
// for steps that do not show.
const wallBandCount = 10;

// Ground pixels on MapLibre's 512 px tiles at a WGS84 latitude and zoom.
export function groundPixels(metres, latitudeDegrees, zoom) {
  const latitudeRadians = (latitudeDegrees * Math.PI) / 180;
  return (metres * tileSizePixels * 2 ** zoom) / (metresAroundEquator * Math.cos(latitudeRadians));
}

export function pixelsPerMetreAtZoom16(latitudeDegrees) {
  return groundPixels(1, latitudeDegrees, wallReferenceZoom);
}

// Consecutive whole-zoom stops let MapLibre's exponential interpolation double a ground distance per zoom level.
// The floor sits inside each stop because MapLibre only accepts zoom at the top of an interpolation.
function groundScaled(pixelsAtZoom16, floorPixels) {
  const zoomSteps = [canyonMinZoom, wallReferenceZoom, wallMaxZoom];
  const stops = zoomSteps.flatMap(zoom => {
    const scaledPixels = ['*', pixelsAtZoom16, 2 ** (zoom - wallReferenceZoom)];
    return [zoom, ['max', floorPixels, scaledPixels]];
  });
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops];
}

const wallPixelsPerMetre = [
  'coalesce',
  ['feature-state', wallPixelsPerMetreStateKey],
  pixelsPerMetreAtZoom16(fallbackLatitudeDegrees)
];

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
  const paintedWidthPixels = ['*', ['coalesce', ['get', 'width'], 0], wallPixelsPerMetre];
  const minimumBandPixels = minimumWallWidthPixels * widthShare;
  return inDrawingGroup('canyon-walls', {
    id: `canyon-wall-${bandIndex}`,
    type: 'line',
    source: basemapSource,
    'source-layer': canyonSourceLayer,
    minzoom: canyonMinZoom,
    layout: {'line-cap': 'butt', 'line-join': 'round'},
    paint: {
      'line-color': colorForDepth(bandIndex),
      'line-width': groundScaled(['*', paintedWidthPixels, widthShare], minimumBandPixels),
      'line-offset': groundScaled(['*', paintedWidthPixels, widthShare / 2], minimumBandPixels / 2)
    }
  });
}

// Gives each rim its own pixel scale as tiles arrive; a rim without a scale falls back until this runs.
export function installCanyonWallScales(map) {
  const latitudeTotals = new Map();
  const seenCoordinates = new Map();
  const appliedLatitudes = new Map();
  // A rim can be clipped across tiles; averaging every distinct vertex stops the first tile choosing its latitude.
  const collectRimLatitudes = rims => {
    for (const rim of rims) {
      if (rim.id === undefined) continue;
      const coordinates = rim.geometry?.coordinates ?? [];
      const total = latitudeTotals.get(rim.id) ?? {sum: 0, count: 0};
      const seen = seenCoordinates.get(rim.id) ?? new Set();
      for (const coordinate of coordinates) {
        if (!Number.isFinite(coordinate[1])) continue;
        const coordinateKey = coordinate.join(',');
        if (seen.has(coordinateKey)) continue;
        seen.add(coordinateKey);
        total.sum += coordinate[1];
        total.count += 1;
      }
      if (seen.size) {
        seenCoordinates.set(rim.id, seen);
        latitudeTotals.set(rim.id, total);
      }
    }
  };
  const applyNewScales = () => {
    for (const [id, total] of latitudeTotals) {
      const latitude = total.sum / total.count;
      if (appliedLatitudes.get(id) === latitude) continue;
      appliedLatitudes.set(id, latitude);
      map.setFeatureState(
        {source: basemapSource, sourceLayer: canyonSourceLayer, id},
        {[wallPixelsPerMetreStateKey]: pixelsPerMetreAtZoom16(latitude)}
      );
    }
  };
  const measureNewRims = () => {
    collectRimLatitudes(map.querySourceFeatures(basemapSource, {sourceLayer: canyonSourceLayer}));
    applyNewScales();
  };
  const onSourceData = event => {
    if (event.sourceId === basemapSource) measureNewRims();
  };
  map.on('sourcedata', onSourceData);
  measureNewRims();
  return () => map.off('sourcedata', onSourceData);
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
