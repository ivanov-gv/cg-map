import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';

const source = 'basemap';
const roadKind = ['get', 'kind'];
const greenLandKinds = [
  'park', 'garden', 'woods', 'meadow', 'grass',
  'scrub', 'sports', 'cemetery', 'playground'
];
const majorRoadKinds = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'motorway_link',
  'trunk_link',
  'primary_link',
  'secondary_link'
];

const roadKindFilter = roadKinds => ['in', roadKind, ['literal', roadKinds]];
const majorRoadFilter = roadKindFilter(majorRoadKinds);
// Ways that are not carriageways get their own pattern; one generic minor-road stroke hides the walking network.
const nonStreetFilter = roadKindFilter(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);
const streetFilter = ['all', ['!', majorRoadFilter], ['!', nonStreetFilter]];

function roadLineLayer({id, color, width, filter, minzoom = 0, dash}) {
  return {
    id,
    type: 'line',
    source,
    'source-layer': 'roads',
    minzoom,
    ...(filter ? {filter} : {}),
    layout: {'line-cap': dash ? 'butt' : 'round', 'line-join': 'round'},
    paint: {
      'line-color': color,
      'line-width': width,
      ...(dash ? {'line-dasharray': dash} : {})
    }
  };
}

// Path widths grow from a thin line at zoom 13 to a street-like stroke at zoom 20.
function scaledWidth(widthAtZoom14, widthAtZoom17, widthAtZoom20) {
  const firstPathZoomFactor = 0.6;
  return [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    13,
    widthAtZoom14 * firstPathZoomFactor,
    14,
    widthAtZoom14,
    17,
    widthAtZoom17,
    20,
    widthAtZoom20
  ];
}

function landLayers() {
  return [
    inDrawingGroup('land', {
      id: 'background',
      type: 'background',
      paint: {'background-color': colors.background}
    }),
    inDrawingGroup('land', {
      id: 'land',
      type: 'fill',
      source,
      'source-layer': 'land',
      paint: {
        'fill-color': ['case', ['in', ['get', 'kind'], ['literal', greenLandKinds]], colors.park, colors.land]
      }
    })
  ];
}

function waterLayers() {
  // Coastlines are separate source lines, so the ocean fill shows the shore without a river stroke.
  const waterwayLineFilter = [
    'all',
    ['==', ['geometry-type'], 'LineString'],
    ['!=', ['get', 'kind'], 'coastline']
  ];
  return [
    inDrawingGroup('water', {
      id: 'water',
      type: 'fill',
      source,
      'source-layer': 'water',
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {'fill-color': colors.water}
    }),
    inDrawingGroup('water', {
      id: 'rivers',
      type: 'line',
      source,
      'source-layer': 'water',
      filter: waterwayLineFilter,
      paint: {
        'line-color': colors.water,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 13, 3, 18, 12]
      }
    })
  ];
}

// Building type is not in the published data yet: one neutral "unknown type" fill, never a residential colour.
function buildingLayers() {
  return [
    inDrawingGroup('buildings', {
      id: 'buildings',
      type: 'fill',
      source,
      'source-layer': 'buildings',
      minzoom: 13,
      paint: {'fill-color': colors.building, 'fill-outline-color': colors.buildingOutline}
    })
  ];
}

// Casings come first so every street fill covers the casing of the streets it crosses.
function streetLayers() {
  const minorStreetWidth = [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    11,
    0.8,
    14,
    ['match', roadKind, 'service', 1.2, 2],
    17,
    ['match', roadKind, 'service', 5, 8],
    20,
    ['match', roadKind, 'service', 22, 35]
  ];
  const streets = [
    roadLineLayer({
      id: 'road-casing',
      color: colors.majorStreetCasing,
      width: ['interpolate', ['exponential', 1.5], ['zoom'], 7, 0.7, 12, 2, 16, 9, 20, 65],
      filter: majorRoadFilter
    }),
    roadLineLayer({
      id: 'minor-casing',
      color: colors.minorStreetCasing,
      width: ['interpolate', ['exponential', 1.5], ['zoom'], 13, 1.6, 14, 3.2, 17, 10, 20, 38],
      filter: streetFilter,
      minzoom: 13
    }),
    roadLineLayer({id: 'minor-roads', color: colors.minorStreet, width: minorStreetWidth, filter: streetFilter, minzoom: 11}),
    roadLineLayer({
      id: 'pedestrian-streets',
      color: colors.pedestrianStreet,
      width: scaledWidth(2.5, 7, 28),
      filter: roadKindFilter(['pedestrian']),
      minzoom: 13
    }),
    roadLineLayer({
      id: 'major-roads',
      color: colors.majorStreet,
      width: ['interpolate', ['exponential', 1.5], ['zoom'], 7, 0.5, 12, 1.3, 16, 6, 20, 48],
      filter: majorRoadFilter
    })
  ];
  return streets.map(layer => inDrawingGroup('streets', layer));
}

function walkingLayers() {
  return [
    inDrawingGroup('trails', roadLineLayer({
      id: 'paths',
      color: colors.path,
      width: scaledWidth(1.1, 1.8, 3.5),
      filter: roadKindFilter(['path', 'track']),
      minzoom: 13,
      dash: [4, 2]
    })),
    inDrawingGroup('main-routes', roadLineLayer({
      id: 'footways',
      color: colors.footway,
      width: scaledWidth(1.1, 1.8, 3.5),
      filter: roadKindFilter(['footway', 'pedestrian']),
      minzoom: 13,
      dash: [2, 1.4]
    })),
    inDrawingGroup('main-routes', roadLineLayer({
      id: 'cycleways',
      color: colors.cycleway,
      width: scaledWidth(1.2, 2, 4),
      filter: roadKindFilter(['cycleway']),
      minzoom: 13,
      dash: [3, 1.5]
    })),
    inDrawingGroup('stairways', roadLineLayer({
      id: 'steps',
      color: colors.stairway,
      width: scaledWidth(2.4, 4.5, 10),
      filter: roadKindFilter(['steps']),
      minzoom: 13,
      dash: [0.4, 0.35]
    }))
  ];
}

function labelLayers() {
  return [
    inDrawingGroup('labels', {
      id: 'road-labels',
      type: 'symbol',
      source,
      'source-layer': 'roads',
      minzoom: 13,
      filter: ['all', ['has', 'name'], ['!=', ['get', 'name'], '']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 350,
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Semibold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 13]
      },
      paint: {
        'text-color': colors.streetLabel,
        'text-halo-color': colors.streetLabelHalo,
        'text-halo-width': 1.5
      }
    }),
    inDrawingGroup('labels', {
      id: 'building-numbers',
      type: 'symbol',
      source: 'building-addresses',
      minzoom: 13,
      layout: {
        visibility: 'none',
        // An application can supply a separate display number; otherwise this is the source's own house number.
        'text-field': ['coalesce', ['get', 'display_number'], ['get', 'addr:housenumber']],
        'text-font': ['Open Sans Semibold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 11, 21, 14],
        'text-anchor': 'center',
        'text-max-width': 6,
        'text-padding': 2
      },
      paint: {
        'text-color': colors.houseNumber,
        'text-halo-color': colors.houseNumberHalo,
        'text-halo-width': 1
      }
    })
  ];
}

// basemapURL: 'pmtiles://<archive>' for the archive read directly, or the server's TileJSON URL.
// Layers follow drawingGroups bottom to top; points of interest are installed later, above every basemap layer.
export function mapStyle(basemapURL, assetBaseURL) {
  return {
    version: 8,
    glyphs: new URL('fonts/', assetBaseURL).href + '{fontstack}/{range}.pbf',
    sources: {
      'building-addresses': {
        type: 'geojson',
        data: new URL('data/building-labels.geojson', assetBaseURL).href
      },
      basemap: {
        type: 'vector',
        url: basemapURL,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL · Natural Earth'
      }
    },
    layers: [
      ...landLayers(),
      ...waterLayers(),
      ...buildingLayers(),
      ...streetLayers(),
      ...walkingLayers(),
      ...labelLayers()
    ]
  };
}

// Match the 100px metric ScaleControl: it rounds distances below 200m to
// 100m or less. Unprojecting also follows latitude, viewport and pitch changes.
export function installBuildingNumberScale(map) {
  const scaleWidthPixels = 100;
  const numberScaleLimitMetres = 200;
  let isVisible;
  const update = () => {
    const {clientWidth, clientHeight} = map.getContainer();
    const left = map.unproject([clientWidth / 2 - scaleWidthPixels / 2, clientHeight / 2]);
    const right = map.unproject([clientWidth / 2 + scaleWidthPixels / 2, clientHeight / 2]);
    const shouldBeVisible = left.distanceTo(right) < numberScaleLimitMetres;
    if (shouldBeVisible !== isVisible) {
      map.setLayoutProperty('building-numbers', 'visibility', shouldBeVisible ? 'visible' : 'none');
      isVisible = shouldBeVisible;
    }
  };
  map.on('move', update);
  map.on('resize', update);
  update();
  return () => {
    map.off('move', update);
    map.off('resize', update);
  };
}
