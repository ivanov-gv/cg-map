import {basemapColors as colors} from './basemap-palette.js';
import {inDrawingGroup} from './drawing-order.js';
import {canyonLayers} from './canyon-layers.js';
import {hillLabelLayers, slopeLayers} from './hill-layers.js';
import {contourLabelLayers, contourLayers} from './contour-layers.js';

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

// Zoom/width stops of street casings; bridges reuse them so a deck is exactly as wide as its street.
const majorCasingWidthStops = [7, 0.7, 12, 2, 16, 9, 20, 65];
const minorCasingWidthStops = [13, 1.6, 14, 3.2, 17, 10, 20, 38];
const walkingDeckWidthStops = [13, 2, 17, 5, 20, 12];
const bridgeDeckEdgePixels = 2.2;

const roadKindFilter = roadKinds => ['in', roadKind, ['literal', roadKinds]];
const majorRoadFilter = roadKindFilter(majorRoadKinds);
// Ways that are not carriageways get their own pattern; one generic minor-road stroke hides the walking network.
const nonStreetFilter = roadKindFilter(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);
const streetFilter = ['all', ['!', majorRoadFilter], ['!', nonStreetFilter]];

// Dashes end square by default; a dotted line passes cap 'round' with zero-length dashes, so each dot is round.
function roadLineLayer({id, color, width, filter, minzoom = 0, dash, cap = dash ? 'butt' : 'round', opacity}) {
  return {
    id,
    type: 'line',
    source,
    'source-layer': 'roads',
    minzoom,
    ...(filter ? {filter} : {}),
    layout: {'line-cap': cap, 'line-join': 'round'},
    paint: {
      'line-color': color,
      'line-width': width,
      ...(dash ? {'line-dasharray': dash} : {}),
      ...(opacity === undefined ? {} : {'line-opacity': opacity})
    }
  };
}

function zoomWidth(widthStops) {
  return ['interpolate', ['exponential', 1.5], ['zoom'], ...widthStops];
}

// The same stops with a fixed number of pixels added on each side of the line.
function widenedZoomWidth(widthStops, pixelsPerSide) {
  const widened = widthStops.map((value, index) => (index % 2 === 0 ? value : value + 2 * pixelsPerSide));
  return zoomWidth(widened);
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

// Meadows mark places people go to (the land layer's destination flag), not every grassy patch, which stays park green.
function meadowLayers() {
  return [
    inDrawingGroup('meadows', {
      id: 'meadows',
      type: 'fill',
      source,
      'source-layer': 'land',
      minzoom: 13,
      filter: ['==', ['get', 'destination'], true],
      paint: {'fill-color': colors.meadow}
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
      width: zoomWidth(majorCasingWidthStops),
      filter: majorRoadFilter
    }),
    roadLineLayer({
      id: 'minor-casing',
      color: colors.minorStreetCasing,
      width: zoomWidth(minorCasingWidthStops),
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

// Bridges cross over the canyon and the water: a deck as wide as its street's casing, with dark edges on both sides.
// Walking bridges get a narrow deck; their path pattern is drawn above it by the walking groups.
function bridgeLayers() {
  const isBridge = ['in', ['get', 'bridge'], ['literal', ['yes', 'viaduct']]];
  const decks = [
    {name: 'major', filter: majorRoadFilter, widthStops: majorCasingWidthStops, color: colors.majorStreet},
    {name: 'minor', filter: streetFilter, widthStops: minorCasingWidthStops, color: colors.minorStreet},
    {name: 'walking', filter: nonStreetFilter, widthStops: walkingDeckWidthStops, color: colors.pedestrianStreet}
  ];
  const layers = decks.flatMap(({name, filter, widthStops, color}) => [
    roadLineLayer({
      id: `bridge-${name}-edges`,
      color: colors.bridgeDeckEdge,
      width: widenedZoomWidth(widthStops, bridgeDeckEdgePixels),
      filter: ['all', isBridge, filter],
      minzoom: 13
    }),
    roadLineLayer({
      id: `bridge-${name}-decks`,
      color,
      width: zoomWidth(widthStops),
      filter: ['all', isBridge, filter],
      minzoom: 13
    })
  ]);
  return layers.map(layer => inDrawingGroup('bridges', layer));
}

// Walking paths by what they are to a walker (wiki UI 3.Core, Penpot hills rules):
// - park routes: main (paved or maintained) paths inside green areas, a cream path over a casing;
// - trails: rough paths anywhere, and paths and unpaved footways without a class, a quiet dotted line;
// - city footpaths: main footways and paths outside green areas, small round dots;
// - stairways: a step pattern; cycleways outside parks keep their own blue dashes.
const pathClass = ['get', 'pathClass'];
const isInGreenArea = ['==', ['get', 'inGreenArea'], true];
const isParkRoute = ['all', isInGreenArea, ['==', pathClass, 'main'], roadKindFilter(['footway', 'path', 'cycleway'])];
// Steps, cycleways and pedestrian streets with a trail class (OSM sac_scale) keep their own pattern.
const isTrail = [
  'all',
  roadKindFilter(['footway', 'path', 'track']),
  ['any', ['==', pathClass, 'trail'], ['!', ['has', 'pathClass']]]
];
const isCityFootpath = ['all', ['!', isInGreenArea], ['==', pathClass, 'main'], roadKindFilter(['footway', 'path'])];
const isCyclewayOutsideParks = ['all', roadKindFilter(['cycleway']), ['!', isParkRoute]];
// Dot spacing in line widths, the Penpot value: a zero-length dash with round caps is one dot, so 1.8 px dots sit about
// 4 px apart, centre to centre.
const dottedLine = [0, 2.2];
const trailOpacity = 0.75;

function walkingLayers() {
  return [
    inDrawingGroup('trails', roadLineLayer({
      id: 'paths',
      color: colors.trail,
      width: scaledWidth(1, 1.5, 3),
      filter: isTrail,
      minzoom: 13,
      dash: dottedLine,
      cap: 'round',
      opacity: trailOpacity
    })),
    inDrawingGroup('trails', roadLineLayer({
      id: 'footways',
      color: colors.cityFootpath,
      width: scaledWidth(1.2, 1.8, 3.5),
      filter: isCityFootpath,
      minzoom: 13,
      dash: dottedLine,
      cap: 'round'
    })),
    inDrawingGroup('main-routes', roadLineLayer({
      id: 'park-route-casing',
      color: colors.parkRouteCasing,
      width: scaledWidth(2.4, 3.6, 9),
      filter: isParkRoute,
      minzoom: 13
    })),
    inDrawingGroup('main-routes', roadLineLayer({
      id: 'park-routes',
      color: colors.parkRoute,
      width: scaledWidth(1.4, 2.2, 6),
      filter: isParkRoute,
      minzoom: 13
    })),
    inDrawingGroup('main-routes', roadLineLayer({
      id: 'cycleways',
      color: colors.cycleway,
      width: scaledWidth(1.2, 2, 4),
      filter: isCyclewayOutsideParks,
      minzoom: 13,
      dash: [3, 1.5]
    })),
    inDrawingGroup('stairways', roadLineLayer({
      id: 'steps',
      color: colors.stairway,
      width: scaledWidth(2.4, 4, 9),
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
      ...slopeLayers(),
      ...canyonLayers(),
      ...waterLayers(),
      ...buildingLayers(),
      ...meadowLayers(),
      ...contourLayers(),
      ...streetLayers(),
      ...bridgeLayers(),
      ...walkingLayers(),
      ...contourLabelLayers(),
      ...labelLayers(),
      ...hillLabelLayers()
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
