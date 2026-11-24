// Files with no layer in the public style at this core version still need their own look while they are edited, so
// turning off edit guides never removes the only rendering of an object.
const textFont = ['Open Sans Semibold'];
const textColor = '#304c3e';
const haloColor = '#fffff9';

const fromFile = filename => ['==', ['get', 'sourceFile'], filename];

function nameLayer(id, filename, textField, layout = {}) {
  return {
    id,
    type: 'symbol',
    filter: fromFile(filename),
    layout: {'text-field': textField, 'text-font': textFont, 'text-size': 11, ...layout},
    paint: {'text-color': textColor, 'text-halo-color': haloColor, 'text-halo-width': 2}
  };
}

function circleLayer(id, filename, color, radiusPixels) {
  return {
    id,
    type: 'circle',
    filter: fromFile(filename),
    paint: {
      'circle-radius': radiusPixels,
      'circle-color': color,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  };
}

function lineLayer(id, filename, color, widthPixels, dashes) {
  const paint = {'line-color': color, 'line-width': widthPixels};
  if (dashes) paint['line-dasharray'] = dashes;
  return {id, type: 'line', filter: fromFile(filename), paint};
}

// Soft enough to leave what stands on the slopes readable.
const slopeLayer = {
  id: 'editor-slopes',
  type: 'fill',
  filter: fromFile('slopes.geojson'),
  paint: {'fill-color': ['match', ['get', 'aspect'], 'sunlit', '#c9ddb2', '#8fb06f'], 'fill-opacity': 0.4}
};

function inspectionLayers() {
  const below = {'text-anchor': 'top', 'text-offset': [0, 1.4]};
  return [
    slopeLayer,
    lineLayer('editor-country-outlines', 'context-countries.geojson', '#aeac98', 1),
    lineLayer('editor-borders', 'border-edges.geojson', '#7d6a8f', 1.5, [4, 2]),
    lineLayer('editor-contours', 'contours.geojson', '#b59a72', 1),
    {
      id: 'editor-flow',
      type: 'symbol',
      minzoom: 14,
      filter: [
        'all',
        fromFile('water.geojson'),
        ['==', ['geometry-type'], 'LineString'],
        ['!=', ['get', 'kind'], 'coastline']
      ],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 80,
        'text-field': '›',
        'text-font': textFont,
        'text-size': 18,
        'text-keep-upright': false,
        'text-allow-overlap': true
      },
      paint: {'text-color': '#2c6fb0', 'text-halo-color': haloColor, 'text-halo-width': 1.5}
    },
    {
      ...lineLayer('editor-coastline', 'water.geojson', '#2c6fb0', 1),
      filter: ['all', fromFile('water.geojson'), ['==', ['get', 'kind'], 'coastline']]
    },
    lineLayer('editor-ridges', 'ridges.geojson', '#8a6d46', 2),
    lineLayer('editor-rims', 'canyon-rims.geojson', '#8b8276', 2),
    lineLayer('editor-protected-areas', 'protected-areas.geojson', '#5f8f57', 1.5, [4, 2]),
    {...circleLayer('editor-entrances', 'building-entrances.geojson', '#193f36', 4), minzoom: 16},
    {...circleLayer('editor-road-nodes', 'road-nodes.geojson', '#8a6d46', 3), minzoom: 15},
    circleLayer('editor-summits', 'summits.geojson', '#8a6d46', 4),
    circleLayer('editor-settlements', 'settlements.geojson', '#304c3e', 4),
    {...circleLayer('editor-stops', 'transport-stops.geojson', '#2c6fb0', 4), minzoom: 12},
    {...nameLayer('editor-stop-names', 'transport-stops.geojson', ['get', 'name'], below), minzoom: 14},
    nameLayer('editor-settlement-names', 'settlements.geojson', ['get', 'name'], below),
    nameLayer('editor-summit-names', 'summits.geojson', ['concat', ['coalesce', ['get', 'name'], ''], ' ', ['to-string', ['get', 'ele']], ' m'], below),
    {
      ...nameLayer('editor-contour-heights', 'contours.geojson', ['to-string', ['get', 'elevation']], {
        'symbol-placement': 'line',
        'text-size': 10
      }),
      minzoom: 13
    }
  ];
}

// Returns the IDs of the installed layers, which are also what a tap can pick.
export function installInspectionLayers(map, source) {
  const layers = inspectionLayers().map(layer => ({...layer, source}));
  for (const layer of layers) map.addLayer(layer);
  return layers.map(({id}) => id);
}
