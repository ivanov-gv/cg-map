// Resolve map taps using explicit current directory state and selection callbacks.
import {describePoint} from './point-selection.js';

const GREEN_LAND_KINDS = new Set([
  'park', 'garden', 'woods', 'meadow', 'grass',
  'scrub', 'sports', 'cemetery', 'playground'
]);

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
      showPlace(feature.properties.id);
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
  const {buildingAddresses, showPoint, onEmptyTap, roadLayers} = context;
  // Road labels are symbol hits, not road lines: map-core's road ids cover the lines, so keep labels separate.
  const roadHitLayers = ['road-labels', ...roadLayers];
  // A map-core release without the protected-area layer must not make the query fail, so ask only for existing layers.
  const queryLayers = [
    'building-numbers',
    'buildings',
    ...roadHitLayers,
    'land',
    'protected-areas',
    'water',
    'rivers'
  ];
  const features = map.queryRenderedFeatures(event.point, {layers: queryLayers.filter(id => map.getLayer(id))});
  const isGreenArea = feature => feature.layer.id === 'land' && GREEN_LAND_KINDS.has(feature.properties.kind);
  const isWater = feature => feature.layer.id === 'water' || feature.layer.id === 'rivers';
  const isNamed = feature => Boolean(feature.properties.name?.trim());
  // A named park or lake is the place itself; inside a protected area such as Park šuma Gorica the unnamed woods or
  // stream under the tap give way to the area's name.
  const selectedFeature =
    features.find(feature => feature.layer.id === 'buildings') ??
    features.find(feature => feature.layer.id === 'building-numbers') ??
    features.find(feature => roadHitLayers.includes(feature.layer.id)) ??
    features.find(feature => isGreenArea(feature) && isNamed(feature)) ??
    features.find(feature => isWater(feature) && isNamed(feature)) ??
    features.find(feature => feature.layer.id === 'protected-areas') ??
    features.find(isGreenArea) ??
    features.find(isWater);
  if (!selectedFeature && onEmptyTap?.()) return;
  showPoint(describePoint(selectedFeature, event.lngLat.toArray(), buildingAddresses), selectedFeature);
}
