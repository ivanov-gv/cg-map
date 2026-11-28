import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

// The Penpot hills rules suggest contours from zoom 15; the tiles carry every 20 m line from zoom 14.
const contourMinZoom = 15;
const thinContourWidth = 0.7;
const indexContourWidth = 1.4;
const thinContourOpacity = 0.28;
const indexContourOpacity = 0.45;
const indexElevationIntervalMetres = 100;

// Data keeps publishing contours in `contours`. Each line already carries its own height, so the style derives the
// index band from `elevation` instead of reading the stored `index` flag that data will drop.
const contourElevation = ['to-number', ['get', 'elevation'], 0];
const isIndexContour = ['==', ['%', contourElevation, indexElevationIntervalMetres], 0];

export const contourLineWidth = ['case', isIndexContour, indexContourWidth, thinContourWidth];
export const contourLineOpacity = ['case', isIndexContour, indexContourOpacity, thinContourOpacity];

function contourLineLayer() {
  return inDrawingGroup('contour-lines', {
    id: 'contour-lines',
    type: 'line',
    source: 'basemap',
    'source-layer': 'contours',
    minzoom: contourMinZoom,
    layout: {'line-join': 'round'},
    paint: {
      'line-color': colors.contour,
      'line-opacity': contourLineOpacity,
      'line-width': contourLineWidth
    }
  });
}

// The height, number only, along its own line. Contours run with higher ground on their left (relief contract) and
// a line label's top faces the line's left, so keeping labels un-flipped makes every height read facing uphill.
// The halo hides the faint line under the digits, the design's small gap. Its colour sits halfway between land and the
// sunlit slope, thin and soft, so it reads as a gap on both. The labels are drawn with the labels group, above streets,
// so a street never covers a height.
function contourLabelLayer() {
  return inDrawingGroup('labels', {
    id: 'contour-labels',
    type: 'symbol',
    source: 'basemap',
    'source-layer': 'contours',
    minzoom: contourMinZoom,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 400,
      'text-field': ['to-string', ['get', 'elevation']],
      'text-font': ['Open Sans Semibold'],
      'text-size': 9,
      'text-keep-upright': false,
      'text-max-angle': 25,
      'text-padding': 4
    },
    paint: {
      'text-color': colors.contour,
      'text-halo-color': colors.contourLabelHalo,
      'text-halo-width': 1,
      'text-halo-blur': 0.5
    }
  });
}

export function contourLayers() {
  return [contourLineLayer()];
}

export function contourLabelLayers() {
  return [contourLabelLayer()];
}
