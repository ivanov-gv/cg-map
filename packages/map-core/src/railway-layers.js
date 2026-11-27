import {basemapColors as colors, colorChannels} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const source = 'basemap';
const railwayMinZoom = 12;
const railwayKind = ['get', 'kind'];
const isPlatform = ['==', railwayKind, 'platform'];
const isPolygon = ['==', ['geometry-type'], 'Polygon'];
const isLine = ['==', ['geometry-type'], 'LineString'];
// Short light dashes break the softer bed into fine ties. Dash lengths are multiples of the line width, so thinner
// lines shorten the ties too; a continuous light line would read as a road.
const tieDashArray = [0.85, 1.35];
const disusedDashArray = [3, 2];
const disusedOpacity = 0.55;
export const railwayIconId = 'railway-station-symbol';
const iconSizePixels = 16;
const iconPixelRatio = 2;
const glyphColor = [255, 255, 255];

const wideningWidth = stops => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
const trackWidth = wideningWidth([12, 0.7, 14, 1.3, 17, 3.3, 20, 12]);
const tieWidth = wideningWidth([12, 0.6, 14, 1.1, 17, 2.7, 20, 10]);
const disusedWidth = wideningWidth([12, 0.55, 14, 0.9, 17, 2.1, 20, 7]);
const platformWidth = wideningWidth([12, 1, 14, 2, 17, 6, 20, 22]);
const labelSize = stops => ['interpolate', ['linear'], ['zoom'], ...stops];

function railwayLineLayer({id, filter, color, width, dash, opacity}) {
  return inDrawingGroup('railways', {
    id,
    type: 'line',
    source,
    'source-layer': 'railways',
    minzoom: railwayMinZoom,
    filter,
    layout: {'line-cap': dash ? 'butt' : 'round', 'line-join': 'round'},
    paint: {
      'line-color': color,
      'line-width': width,
      ...(dash ? {'line-dasharray': dash} : {}),
      ...(opacity === undefined ? {} : {'line-opacity': opacity})
    }
  });
}

// Platforms are areas where mapped, and narrow strokes where only their centre line is mapped.
export function railwayLayers() {
  return [
    inDrawingGroup('railways', {
      id: 'platform-areas',
      type: 'fill',
      source,
      'source-layer': 'railways',
      minzoom: railwayMinZoom,
      filter: ['all', isPlatform, isPolygon],
      paint: {'fill-color': colors.railwayPlatform, 'fill-outline-color': colors.minorStreetCasing}
    }),
    railwayLineLayer({
      id: 'platform-lines',
      filter: ['all', isPlatform, isLine],
      color: colors.railwayPlatform,
      width: platformWidth
    }),
    railwayLineLayer({
      id: 'rail-casing',
      filter: ['all', isLine, ['==', railwayKind, 'rail']],
      color: colors.railwayTrack,
      width: trackWidth
    }),
    railwayLineLayer({
      id: 'rail-ties',
      filter: ['all', isLine, ['==', railwayKind, 'rail']],
      color: colors.railwayTie,
      width: tieWidth,
      dash: tieDashArray
    }),
    railwayLineLayer({
      id: 'disused-rail',
      filter: ['all', isLine, ['==', railwayKind, 'disused_rail']],
      color: colors.railwayTrack,
      width: disusedWidth,
      dash: disusedDashArray,
      opacity: disusedOpacity
    })
  ];
}

// Stations and halts share the style's label treatment: a symbol and a name above a halo, in the labels group.
function stopLayer(id, kind, iconSize, sizeStops) {
  return inDrawingGroup('labels', {
    id,
    type: 'symbol',
    source,
    'source-layer': 'railways',
    minzoom: railwayMinZoom,
    filter: ['==', railwayKind, kind],
    layout: {
      'icon-image': railwayIconId,
      'icon-size': iconSize,
      // Like POI icons, a station badge must not disappear under a crowded street label at high zoom.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
      'text-font': ['Open Sans Semibold'],
      'text-size': labelSize(sizeStops),
      'text-anchor': 'top',
      'text-offset': [0, 0.6],
      'text-optional': true
    },
    paint: {
      'text-color': colors.streetLabel,
      'text-halo-color': colors.streetLabelHalo,
      'text-halo-width': 1.5
    }
  });
}

export function railwayLabelLayers() {
  return [
    stopLayer('railway-halts', 'halt', 0.8, [12, 9, 17, 11, 20, 13]),
    stopLayer('railway-stations', 'station', 1, [12, 10, 17, 12, 20, 15])
  ];
}

// A dark badge with two rails and a sleeper, as raw pixels: the style has no sprite and this needs no canvas.
export function railwayIcon() {
  const size = iconSizePixels * iconPixelRatio;
  const data = new Uint8Array(size * size * 4);
  const badgeRadius = size / 2 - iconPixelRatio;
  const glyphHalfThickness = 0.8 * iconPixelRatio;
  const glyphHalfLength = 4 * iconPixelRatio;
  const railOffset = 2 * iconPixelRatio;
  const [red, green, blue] = colorChannels(colors.railwaySymbol);
  for (let row = 0; row < size; row++) {
    const vertical = row + 0.5 - size / 2;
    for (let column = 0; column < size; column++) {
      const horizontal = column + 0.5 - size / 2;
      if (Math.hypot(horizontal, vertical) > badgeRadius) continue;
      const isRail =
        Math.abs(Math.abs(horizontal) - railOffset) <= glyphHalfThickness && Math.abs(vertical) <= glyphHalfLength;
      const isSleeper =
        Math.abs(vertical) <= glyphHalfThickness && Math.abs(horizontal) <= glyphHalfLength;
      data.set([...(isRail || isSleeper ? glyphColor : [red, green, blue]), 255], (row * size + column) * 4);
    }
  }
  return {image: {width: size, height: size, data}, options: {pixelRatio: iconPixelRatio}};
}

// Adds the badge when the style first asks for it; MapLibre then draws the station symbols.
export function installRailwayIcon(map) {
  const addWhenMissing = event => {
    if (event.id !== railwayIconId || map.hasImage(railwayIconId)) return;
    const {image, options} = railwayIcon();
    map.addImage(railwayIconId, image, options);
  };
  map.on('styleimagemissing', addWhenMissing);
  return () => map.off('styleimagemissing', addWhenMissing);
}
