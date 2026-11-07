// Decides what one map tap selects. It reads rendered features only and changes nothing, so the app decides what to show.
import {listingsAtHits} from '@ivanov-gv/map-core';
import {describePoint} from './point-selection.js';

const entranceLayers = ['entrance-points', 'entrance-selection-numbers', 'entrance-numbers', 'entrance-selection-arrows'];
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
const geographyLayers = ['building-numbers', 'buildings', ...roadLayers, 'land', 'water', 'rivers'];

const pointTarget = (point, feature) => ({kind: 'point', point, feature});

function routeEndpointPoint(feature) {
  return {
    name: feature.properties.name,
    coordinates: [...feature.geometry.coordinates],
    kind: feature.properties.role === 'from' ? 'From point' : 'To point',
    details: []
  };
}

// Route endpoints, entrances, stops and listings, in that order of precedence; null when the tap hit none of them.
function markerTarget(map, event, {placeHitLayers, placesById, buildingAddresses}) {
  const tappedCoordinates = event.lngLat.toArray();
  const featuresIn = layers => map.queryRenderedFeatures(event.point, {layers});

  const [routeEndpoint] = featuresIn(['route-point-circles']);
  if (routeEndpoint) return pointTarget(routeEndpointPoint(routeEndpoint), routeEndpoint);

  const [entrance] = featuresIn(entranceLayers);
  if (entrance) return pointTarget(describePoint(entrance, tappedCoordinates, buildingAddresses), entrance);

  const [stop] = featuresIn(['transport-stops']);
  if (stop) return pointTarget(describePoint(stop, tappedCoordinates), stop);

  const listings = listingsAtHits(featuresIn(placeHitLayers), placesById);
  if (listings.length === 1) return {kind: 'place', place: listings[0]};
  if (listings.length > 1) return {kind: 'chooser', listings, coordinates: tappedCoordinates};
  return null;
}

// Among geographic objects the most specific one under the tap wins. With none, the tap is a bare map point.
function geographyTarget(map, event, buildingAddresses) {
  const features = map.queryRenderedFeatures(event.point, {layers: geographyLayers});
  const isInLayer = (feature, layerId) => feature.layer.id === layerId;
  const feature =
    features.find(candidate => isInLayer(candidate, 'buildings')) ??
    features.find(candidate => isInLayer(candidate, 'building-numbers')) ??
    features.find(candidate => roadLayers.includes(candidate.layer.id)) ??
    features.find(candidate => isInLayer(candidate, 'land') && candidate.properties.kind === 'park') ??
    features.find(candidate => isInLayer(candidate, 'water') || isInLayer(candidate, 'rivers'));
  return pointTarget(describePoint(feature, event.lngLat.toArray(), buildingAddresses), feature);
}

// Returns {kind: 'point', point, feature}, {kind: 'place', place} or {kind: 'chooser', listings, coordinates}.
// Listings win over geography, so a marker drawn over a building opens the listing.
// context: {placeHitLayers, placesById, buildingAddresses}
export function tapTarget(map, event, context) {
  return markerTarget(map, event, context) ?? geographyTarget(map, event, context.buildingAddresses);
}
