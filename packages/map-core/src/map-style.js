// basemapURL: 'pmtiles://<archive>' for the archive read directly, or the server's TileJSON URL.
export function mapStyle(basemapURL, assetBaseURL) {
  const source = 'basemap';
  const roadKind = ['get', 'kind'];
  const majorRoadFilter = [
    'in',
    roadKind,
    [
      'literal',
      [
        'motorway',
        'trunk',
        'primary',
        'secondary',
        'tertiary',
        'motorway_link',
        'trunk_link',
        'primary_link',
        'secondary_link'
      ]
    ]
  ];
  const roadKindFilter = roadKinds => ['in', roadKind, ['literal', roadKinds]];
  // Ways that are not carriageways get their own pattern; one generic minor-road stroke hides the walking network.
  const nonStreetFilter = roadKindFilter(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);
  const streetFilter = ['all', ['!', majorRoadFilter], ['!', nonStreetFilter]];
  const roadLineLayer = (id, color, width, filter, minzoom = 0, dash) => ({
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
  });
  const scaledWidth = (widthAtZoom14, widthAtZoom17, widthAtZoom20) => [
    'interpolate',
    ['exponential', 1.5],
    ['zoom'],
    13,
    widthAtZoom14 * 0.6,
    14,
    widthAtZoom14,
    17,
    widthAtZoom17,
    20,
    widthAtZoom20
  ];
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
      {
        id: 'background',
        type: 'background',
        paint: {'background-color': '#f2f1e7'}
      },
      {
        id: 'land',
        type: 'fill',
        source,
        'source-layer': 'land',
        paint: {
          'fill-color': ['match', ['get', 'kind'], 'park', '#dce6c9', '#efeee2']
        }
      },
      {
        id: 'water',
        type: 'fill',
        source,
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {'fill-color': '#c3dce0'}
      },
      {
        id: 'rivers',
        type: 'line',
        source,
        'source-layer': 'water',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#a9ced6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.6, 13, 3, 18, 12]
        }
      },
      // Building type is not in the published data yet: one neutral "unknown type" fill, never a residential colour.
      {
        id: 'buildings',
        type: 'fill',
        source,
        'source-layer': 'buildings',
        minzoom: 13,
        paint: {'fill-color': '#d6d5c6', 'fill-outline-color': '#aeac98'}
      },
      roadLineLayer(
        'road-casing',
        '#d6d1b9',
        ['interpolate', ['exponential', 1.5], ['zoom'], 7, 0.7, 12, 2, 16, 9, 20, 65],
        majorRoadFilter
      ),
      roadLineLayer(
        'minor-casing',
        '#cfcab3',
        ['interpolate', ['exponential', 1.5], ['zoom'], 13, 1.6, 14, 3.2, 17, 10, 20, 38],
        streetFilter,
        13
      ),
      roadLineLayer(
        'minor-roads',
        '#fffef8',
        [
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
        ],
        streetFilter,
        11
      ),
      roadLineLayer('pedestrian-streets', '#f4ead6', scaledWidth(2.5, 7, 28), roadKindFilter(['pedestrian']), 13),
      roadLineLayer(
        'footways',
        '#8c6f4e',
        scaledWidth(1.1, 1.8, 3.5),
        roadKindFilter(['footway', 'pedestrian']),
        13,
        [2, 1.4]
      ),
      roadLineLayer('paths', '#6f7f3c', scaledWidth(1.1, 1.8, 3.5), roadKindFilter(['path', 'track']), 13, [4, 2]),
      roadLineLayer('cycleways', '#2c6fb0', scaledWidth(1.2, 2, 4), roadKindFilter(['cycleway']), 13, [3, 1.5]),
      roadLineLayer('steps', '#6b4a32', scaledWidth(2.4, 4.5, 10), roadKindFilter(['steps']), 13, [0.4, 0.35]),
      roadLineLayer(
        'major-roads',
        '#e4c98e',
        ['interpolate', ['exponential', 1.5], ['zoom'], 7, 0.5, 12, 1.3, 16, 6, 20, 48],
        majorRoadFilter
      ),
      {
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
          'text-color': '#7b7b69',
          'text-halo-color': '#f8f8ee',
          'text-halo-width': 1.5
        }
      },
      {
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
          'text-color': '#514d44',
          'text-halo-color': '#fffef8',
          'text-halo-width': 1
        }
      }
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
