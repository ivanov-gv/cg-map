// Public-app overlays. Shared cartography remains in the map-core package.
import {installPlaceIcons, placeColors} from '@ivanov-gv/map-core';
import {featureCollection} from './core.js';

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
