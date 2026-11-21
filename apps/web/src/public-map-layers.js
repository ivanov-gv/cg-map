// Public-app overlays. Shared cartography remains in the map-core package.
import {buildPlaceMarkers, installPlaceIcons, placeColors} from '@ivanov-gv/map-core';
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
  map.addSource('search-result-markers', {type: 'geojson', data: featureCollection([])});
  // An explicit query or category draws every result location here, without a minzoom or a layer per place. Names
  // stay out of this layer: an icon may collide with a label, but the icon itself is never collision-hidden.
  map.addLayer(
    {
      id: 'search-result-places',
      type: 'symbol',
      source: 'search-result-markers',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'count'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {'text-color': '#ffffff'}
    },
    'road-labels'
  );
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
const noStreetNames = ['in', ['get', 'name'], ['literal', []]];
const streetNameFilter = names => ['in', ['get', 'name'], ['literal', names]];

// One marker per result location, carrying every matching listing at that point. The highest band already holds all
// members at a shared location, so it gives the icon and activeIds without any level's zoom threshold.
export function searchResultMarkerData(places, markerKeysById) {
  const bands = buildPlaceMarkers(places, markerKeysById);
  const byMarkerKey = new Map();
  for (const marker of bands) {
    const markerKey = marker.properties.markerKey;
    const chosen = byMarkerKey.get(markerKey);
    if (!chosen || marker.properties.start > chosen.properties.start) byMarkerKey.set(markerKey, marker);
  }
  return featureCollection(
    [...byMarkerKey.values()].map(marker => ({
      type: 'Feature',
      geometry: marker.geometry,
      properties: {
        markerKey: marker.properties.markerKey,
        icon: marker.properties.icon,
        count: marker.properties.count,
        activeIds: marker.properties.activeIds
      }
    }))
  );
}

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
    // A street row has no footprint; filter the road tiles by the street names currently in the visible result set.
    map.addLayer(
      {
        id: 'search-street-outline',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: noStreetNames,
        paint: {
          'line-color': SEARCH_HIGHLIGHT_COLOR,
          'line-width': 4
        },
        layout: {'line-join': 'round', 'line-cap': 'round'}
      },
      'road-labels'
    );
  }

  // One source update when the filter changes, never one per result or per camera move. An empty set hides the layer
  // until explicit results are shown again.
  setResultMarkers(data) {
    this.map.getSource('search-result-markers').setData(data);
    const visibility = data.features.length ? 'visible' : 'none';
    if (this.map.getLayoutProperty('search-result-places', 'visibility') !== visibility)
      this.map.setLayoutProperty('search-result-places', 'visibility', visibility);
  }

  // Every in-view place result has a drawn marker during an explicit filter, so its ring needs no rendered-feature
  // lookup. Shared locations get one ring. An unchanged set touches neither source during panning.
  update(visibleResults) {
    const highlightKey = visibleResults.map(result => result.id).join('|');
    if (highlightKey === this.highlightKey) return;
    this.highlightKey = highlightKey;
    const ringsByMarkerKey = new Map();
    for (const result of visibleResults) {
      if (result.kind !== 'place') continue;
      ringsByMarkerKey.set(result.markerKey, {
        type: 'Feature',
        properties: {markerKey: result.markerKey},
        geometry: {type: 'Point', coordinates: [...result.coordinates]}
      });
    }
    this.map.getSource('search-place-highlights').setData(featureCollection([...ringsByMarkerKey.values()]));
    const footprints = visibleResults
      .filter(result => result.kind === 'building' || result.kind === 'address')
      .map(result => result.footprintIndex);
    const streetNames = [
      ...new Set(visibleResults.filter(result => result.kind === 'street').map(result => result.streetName))
    ];
    this.map.setFilter('search-building-outline', ['in', ['id'], ['literal', footprints]]);
    this.map.setFilter('search-street-outline', streetNameFilter(streetNames));
  }

  clear() {
    if (this.map.getLayoutProperty('search-result-places', 'visibility') !== 'none')
      this.map.setLayoutProperty('search-result-places', 'visibility', 'none');
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
