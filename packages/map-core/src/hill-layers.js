import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const source = 'basemap';
const reliefMinZoom = 12;
export const summitIconId = 'summit-triangle';
const summitIconSizePixels = 9;
const summitIconPixelRatio = 2;

// Slopes come from the relief layer, published only inside green areas, so built-up areas stay flat. The two tones
// mean volume only: sunlit faces south (east through west), shaded faces north.
function slopeLayer(aspect, group, color) {
  return inDrawingGroup(group, {
    id: `${aspect}-slopes`,
    type: 'fill',
    source,
    'source-layer': 'slopes',
    minzoom: reliefMinZoom,
    filter: ['==', ['get', 'aspect'], aspect],
    paint: {'fill-color': color, 'fill-antialias': false}
  });
}

// OSM height first; the terrain model's when OSM has none, rounded to whole metres like a printed map.
const summitHeight = ['round', ['coalesce', ['get', 'ele'], ['get', 'demElevation']]];
const hasName = ['all', ['has', 'name'], ['!=', ['get', 'name'], '']];
// "Gorica · 130 m"; an unnamed summit shows its height only.
export const summitText = [
  'case',
  hasName,
  ['concat', ['get', 'name'], ' · ', ['to-string', summitHeight], ' m'],
  ['concat', ['to-string', summitHeight], ' m']
];

function summitLayer() {
  return inDrawingGroup('labels', {
    id: 'summits',
    type: 'symbol',
    source,
    'source-layer': 'summits',
    minzoom: reliefMinZoom,
    filter: ['any', hasName, ['>=', ['zoom'], 15]],
    layout: {
      'icon-image': summitIconId,
      'icon-allow-overlap': false,
      'text-field': summitText,
      'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 10, 18, 12],
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-optional': true
    },
    paint: {
      'text-color': colors.summit,
      'text-halo-color': colors.summitHalo,
      'text-halo-width': 1
    }
  });
}

// Park names run along the long side of the area (green_area_labels lines from the tile builder).
function parkNameLayer() {
  return inDrawingGroup('labels', {
    id: 'park-names',
    type: 'symbol',
    source,
    'source-layer': 'green_area_labels',
    minzoom: 14,
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 13, 16, 18],
      // The design's 1.5 px at 18 px, in ems.
      'text-letter-spacing': 0.08,
      'text-max-angle': 30
    },
    paint: {
      'text-color': colors.parkName,
      'text-halo-color': colors.parkNameHalo,
      'text-halo-width': 1
    }
  });
}

// Stored shades will replace derived shaded slopes. Data publishes them in their own tile layer, so the style reads
// only the polygon's own kind and paints it with the same tone and zoom as today's shaded slope.
export function shadeLayers() {
  return [
    inDrawingGroup('shades', {
      id: 'shades',
      type: 'fill',
      source,
      'source-layer': 'shades',
      minzoom: reliefMinZoom,
      filter: ['==', ['get', 'kind'], 'shade'],
      paint: {'fill-color': colors.shadedSlope, 'fill-antialias': false}
    })
  ];
}

export function slopeLayers() {
  return [
    slopeLayer('shaded', 'shaded-slopes', colors.shadedSlope),
    slopeLayer('sunlit', 'sunlit-slopes', colors.sunlitSlope)
  ];
}

export function hillLabelLayers() {
  return [parkNameLayer(), summitLayer()];
}

// The summit triangle as raw pixels: the style has no sprite, and this needs no canvas, so it works in any runtime.
export function summitIcon() {
  const size = summitIconSizePixels * summitIconPixelRatio;
  const data = new Uint8Array(size * size * 4);
  const [red, green, blue] = colorChannels(colors.summit);
  for (let row = 0; row < size; row++) {
    // Rows widen from the apex at the top to the full base at the bottom.
    const halfWidth = ((row + 1) / size) * (size / 2);
    for (let column = 0; column < size; column++) {
      const isInside = Math.abs(column + 0.5 - size / 2) <= halfWidth;
      if (!isInside) continue;
      data.set([red, green, blue, 255], (row * size + column) * 4);
    }
  }
  return {image: {width: size, height: size, data}, options: {pixelRatio: summitIconPixelRatio}};
}

// Adds the triangle when the style first asks for it; MapLibre then redraws the summits.
export function installSummitIcon(map) {
  const addWhenMissing = event => {
    if (event.id !== summitIconId || map.hasImage(summitIconId)) return;
    const {image, options} = summitIcon();
    map.addImage(summitIconId, image, options);
  };
  map.on('styleimagemissing', addWhenMissing);
  return () => map.off('styleimagemissing', addWhenMissing);
}
