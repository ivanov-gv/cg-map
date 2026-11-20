// Public-app overlays. Shared cartography remains in the map-core package.
import {installPlaceIcons, placeColors} from '@ivanov-gv/map-core';
import {featureCollection, SEARCH_HIGHLIGHT_COLOR} from './core.js';

// Preserve public layer ordering and the selected-result exception; core supplies reusable rendering.
export function installPublicPlaceLayers(map) {
  // PV-01/PV-02: each level is a zoom range, so eligibility is decided before any collision placement.
  installPlaceIcons(map, placeColors);
  map.addSource('places', {
    type: 'geojson',
    data: featureCollection([]),
    promoteId: 'markerKey'
  });
  map.addSource('requested-place', {type: 'geojson', data: featureCollection([])});
  map.addLayer(
    {
      id: 'place-highlight',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'first'], true],
      paint: {
        'circle-radius': 14,
        'circle-color': '#c43f3f',
        'circle-opacity': 0,
        'circle-stroke-color': '#c43f3f',
        'circle-stroke-width': 0
      }
    },
    'road-labels'
  );
  // The one requested result uses its existing geographic anchor and category icon below its own threshold.
  map.addLayer({
    id: 'search-place',
    type: 'symbol',
    source: 'requested-place',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.1],
      'text-optional': true
    },
    paint: {
      'text-color': '#304c3e',
      'text-halo-color': '#fffff9',
      'text-halo-width': 2
    }
  });
}

const noFootprints = ['in', ['id'], ['literal', []]];

// Green search highlights live in the public app, not in shared cartography. Places use their own point source;
// buildings and addresses filter the original footprint tiles so whole outlines are drawn at any zoom.
export class SearchHighlights {
  constructor(map) {
    this.map = map;
    this.highlightKey = null;
    map.addSource('search-place-highlights', {
      type: 'geojson',
      data: featureCollection([])
    });
    map.addLayer(
      {
        id: 'search-place-rings',
        type: 'circle',
        source: 'search-place-highlights',
        paint: {
          'circle-radius': 15,
          'circle-color': SEARCH_HIGHLIGHT_COLOR,
          'circle-opacity': 0,
          'circle-stroke-color': SEARCH_HIGHLIGHT_COLOR,
          'circle-stroke-width': 3
        }
      },
      'road-labels'
    );
    map.addLayer(
      {
        id: 'search-building-outline',
        type: 'line',
        source: 'basemap',
        'source-layer': 'buildings',
        filter: noFootprints,
        paint: {
          'line-color': SEARCH_HIGHLIGHT_COLOR,
          'line-width': 3
        },
        layout: {'line-join': 'round', 'line-cap': 'round'}
      },
      'road-labels'
    );
  }

  // The listing identities behind markers that are actually drawn: ordinary place icons, plus the below-threshold
  // requested marker. Shared markers list every listing they represent in activeIds.
  drawnPlaceIds() {
    const layers = this.map
      .getStyle()
      .layers.map(layer => layer.id)
      .filter(id => id.startsWith('place-icons-') || id === 'search-place');
    return new Set(
      this.map
        .queryRenderedFeatures({layers})
        .flatMap(feature => JSON.parse(feature.properties.activeIds ?? '[]'))
        .map(String)
    );
  }

  // Rebuild both highlights from the results in view and the markers drawn for them. An unchanged pair touches neither
  // source, so small pans and selection checks do not repaint marks that are already correct. An empty set clears marks.
  update(visibleResults) {
    const drawnIds = this.drawnPlaceIds();
    const highlightKey = [
      visibleResults.map(result => result.id).join('|'),
      [...drawnIds].sort().join('|')
    ].join('\u0000');
    if (highlightKey === this.highlightKey) return;
    this.highlightKey = highlightKey;
    const placeFeatures = visibleResults
      .filter(result => result.kind === 'place' && drawnIds.has(String(result.id)))
      .map(result => ({
        type: 'Feature',
        properties: {markerKey: result.markerKey},
        geometry: {type: 'Point', coordinates: [...result.coordinates]}
      }));
    this.map.getSource('search-place-highlights').setData(featureCollection(placeFeatures));
    const footprints = visibleResults
      .filter(result => result.kind !== 'place')
      .map(result => result.footprintIndex);
    this.map.setFilter('search-building-outline', ['in', ['id'], ['literal', footprints]]);
  }

  clear() {
    this.update([]);
  }
}

export function installCityNames(map) {
  const cities = [
    ['Podgorica', 19.26, 42.437],
    ['Nikšić', 18.944, 42.774],
    ['Cetinje', 18.922, 42.39],
    ['Budva', 18.84, 42.286],
    ['Kotor', 18.771, 42.424],
    ['Bar', 19.098, 42.092],
    ['Ulcinj', 19.206, 41.929],
    ['Herceg Novi', 18.537, 42.454],
    ['Žabljak', 19.121, 43.154],
    ['Pljevlja', 19.359, 43.357],
    ['Kolašin', 19.522, 42.824],
    ['Berane', 19.87, 42.843]
  ];
  map.addSource('cities', {
    type: 'geojson',
    data: featureCollection(
      cities.map(([name, longitude, latitude]) => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [longitude, latitude]},
        properties: {name}
      }))
    )
  });
  map.addLayer({
    id: 'city-names',
    type: 'symbol',
    source: 'cities',
    maxzoom: 13,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 13
    },
    paint: {
      'text-color': '#3c5945',
      'text-halo-color': '#fafaf0',
      'text-halo-width': 2
    }
  });
}
