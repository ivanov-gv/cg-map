// Resolve map taps using explicit current directory state and selection callbacks.
import {describePoint} from './point-selection.js';

function activeIdsFromHit(hit) {
  try {
    const activeIds = JSON.parse(hit.properties.activeIds ?? '[]');
    return Array.isArray(activeIds) ? activeIds : [];
  } catch {
    return [];
  }
}

// The first rendered hit and its first active identity win; co-located places stay reachable through search and buildings.
function selectTappedListing(map, event, context) {
  const {placeHitLayers, placesById, showPlace} = context;
  const hits = map.queryRenderedFeatures(event.point, {layers: placeHitLayers});
  for (const hit of hits) {
    for (const id of activeIdsFromHit(hit)) {
      const feature = placesById.get(id);
      if (!feature) continue;
      showPlace(feature.properties.id, null, {fromMapTap: true});
      return true;
    }
  }
  return false;
}

// Route endpoints, stops and listings win over generic geographic objects. Returns whether one was selected.
function selectTappedMarker(map, event, context) {
  const {buildingAddresses, showPoint} = context;
  const routePoints = map.queryRenderedFeatures(event.point, {
    layers: ['route-point-circles']
  });
  if (routePoints.length) {
    const feature = routePoints[0];
    showPoint(
      {
        name: feature.properties.name,
        coordinates: [...feature.geometry.coordinates],
        kind: feature.properties.role === 'from' ? 'From point' : 'To point'
      },
      feature
    );
    return true;
  }
  const entrances = map.queryRenderedFeatures(event.point, {
    layers: ['entrance-points', 'entrance-selection-numbers', 'entrance-numbers', 'entrance-selection-arrows']
  });
  if (entrances.length) {
    showPoint(describePoint(entrances[0], event.lngLat.toArray(), buildingAddresses), entrances[0]);
    return true;
  }
  const stops = map.queryRenderedFeatures(event.point, {
    layers: ['transport-stops']
  });
  if (stops.length) {
    showPoint(describePoint(stops[0], event.lngLat.toArray()), stops[0]);
    return true;
  }
  return selectTappedListing(map, event, context);
}

// Listings win over geography; among geographic objects the most specific one under the tap wins.
export function selectTappedFeature(map, event, context) {
  if (!context.isMapReady) return;
  if (selectTappedMarker(map, event, context)) return;
  const {buildingAddresses, showPoint} = context;
  const roadLayers = [
    'road-labels',
    'steps',
    'cycleways',
    'paths',
    'footways',
    'pedestrian-streets',
    'minor-roads',
    'major-roads'
  ];
  const features = map.queryRenderedFeatures(event.point, {
    layers: ['building-numbers', 'buildings', ...roadLayers, 'land', 'water', 'rivers']
  });
  const selectedFeature =
    features.find(feature => feature.layer.id === 'buildings') ??
    features.find(feature => feature.layer.id === 'building-numbers') ??
    features.find(feature => roadLayers.includes(feature.layer.id)) ??
    features.find(feature => feature.layer.id === 'land' && feature.properties.kind === 'park') ??
    features.find(feature => feature.layer.id === 'water' || feature.layer.id === 'rivers');
  showPoint(describePoint(selectedFeature, event.lngLat.toArray(), buildingAddresses), selectedFeature);
}
