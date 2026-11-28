import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

// The Penpot hills rules suggest contours from zoom 15; the tiles carry every 20 m line from zoom 14.
const contourMinZoom = 15;
const thinContourWidth = 0.7;
const indexContourWidth = 1.4;
const thinContourOpacity = 0.28;
const indexContourOpacity = 0.45;
const indexElevationIntervalMetres = 100;

// Version 5 drops the stored `index` flag: a contour is an index line when its own height divides by 100 m.
const contourElevation = ['to-number', ['get', 'elevation'], 0];
const isContourGeometry = ['==', ['geometry-type'], 'LineString'];
const hasContourElevation = ['has', 'elevation'];
const isIndexContour = ['==', ['%', contourElevation, indexElevationIntervalMetres], 0];
const isOrdinaryContour = ['all', isContourGeometry, hasContourElevation, ['!', isIndexContour]];
const isIndexedContour = ['all', isContourGeometry, hasContourElevation, isIndexContour];

function contourLineLayer({id, sourceLayer, filter, width = thinContourWidth, opacity = thinContourOpacity}) {
  return inDrawingGroup('contour-lines', {
    id,
    type: 'line',
    source: 'basemap',
    'source-layer': sourceLayer,
    minzoom: contourMinZoom,
    ...(filter ? {filter} : {}),
    layout: {'line-join': 'round'},
    paint: {'line-color': colors.contour, 'line-opacity': opacity, 'line-width': width}
  });
}

// The height, number only, along its own line. Contours run with higher ground on their left (relief contract) and
// a line label's top faces the line's left, so keeping labels un-flipped makes every height read facing uphill.
// The halo hides the faint line under the digits, the design's small gap. Its colour sits halfway between land and the
// sunlit slope, thin and soft, so it reads as a gap on both. The labels are drawn with the labels group, above streets,
// so a street never covers a height.
function contourLabelLayer({id, sourceLayer, filter}) {
  return inDrawingGroup('labels', {
    id,
    type: 'symbol',
    source: 'basemap',
    'source-layer': sourceLayer,
    minzoom: contourMinZoom,
    ...(filter ? {filter} : {}),
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

// Today's `contours` layer stays untouched: it carries every height line and the published `index` flag. Version 5
// publishes contour and summit geometry together in `relief`, so its layers select line geometry and derive the index
// from `elevation`. An archive without a `relief` layer matches none of them and keeps today's look.
export function contourLayers() {
  return [
    contourLineLayer({id: 'contour-lines', sourceLayer: 'contours'}),
    contourLineLayer({id: 'relief-contour-lines', sourceLayer: 'relief', filter: isOrdinaryContour}),
    contourLineLayer({
      id: 'index-contour-lines',
      sourceLayer: 'relief',
      filter: isIndexedContour,
      width: indexContourWidth,
      opacity: indexContourOpacity
    })
  ];
}

export function contourLabelLayers() {
  return [
    contourLabelLayer({id: 'contour-labels', sourceLayer: 'contours'}),
    contourLabelLayer({
      id: 'relief-contour-labels',
      sourceLayer: 'relief',
      filter: ['all', isContourGeometry, hasContourElevation]
    })
  ];
}
