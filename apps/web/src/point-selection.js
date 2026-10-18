// Point descriptions use only published map attributes; unnamed geometry stays unnamed.
export function describePoint(feature, coordinates) {
  const p = feature?.properties ?? {};
  const layer = feature?.layer?.id;
  const stop = layer === 'transport-stops';
  const kind = stop ? 'Bus stop' : layer === 'buildings' ? 'Building' :
    layer === 'land' ? (p.kind === 'park' ? 'Park' : 'Land') :
    ['water', 'rivers'].includes(layer) ? 'Water' :
    layer ? (p.bridge && p.bridge !== 'no' ? 'Bridge' : 'Road') : 'Map point';
  return {
    coordinates: stop ? [...feature.geometry.coordinates] : [...coordinates],
    name: typeof p.name === 'string' && p.name.trim() ? p.name : kind,
    kind,
    details: stop ? [`Stop ID: ${p.stopId}`, 'Source: ePodgorica · snapshot 18 October 2026'] :
      layer ? [p.kind ? `Type: ${p.kind.replaceAll('_', ' ')}` : '',
        [p['addr:street'], p['addr:housenumber']].filter(Boolean).join(' '),
        'Source: OpenStreetMap · available map attributes only'] : []
  };
}

export function endpointFeatures(endpoints) {
  return {type: 'FeatureCollection', features: ['from', 'to'].filter(role => endpoints[role]).map(role => ({
    type: 'Feature', geometry: {type: 'Point', coordinates: [...endpoints[role].coordinates]},
    properties: {role, label: role === 'from' ? 'A' : 'B', name: endpoints[role].name}
  }))};
}

export function installRoutePoints(map) {
  map.addSource('route-points', {type: 'geojson', data: endpointFeatures({})});
  map.addLayer({id: 'route-point-circles', type: 'circle', source: 'route-points', paint: {
    'circle-radius': 15, 'circle-color': ['match', ['get', 'role'], 'from', '#193f36', '#a34c35'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3
  }});
  map.addLayer({id: 'route-point-labels', type: 'symbol', source: 'route-points', layout: {
    'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 12,
    'text-allow-overlap': true, 'text-ignore-placement': true
  }, paint: {'text-color': '#ffffff'}});
}
