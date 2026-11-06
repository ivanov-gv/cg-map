import {installPlaceIcons} from './poi-icons.js';
import {normalizePlaces, markerKeys, buildPlaceMarkers, placeBands, placeLayers} from './place-visibility.js';
import {placeColors} from './palette.js';

// Installs published POIs using the same collision and visibility policy as the public app.
// One instance per map; applications still own search, cards and below-threshold edit overlays.
export function installPlaces(map, features, config) {
  const directory = normalizePlaces(features, config);
  const markerKeysById = markerKeys(directory);
  installPlaceIcons(map, placeColors);
  const data = {
    type: 'FeatureCollection',
    features: buildPlaceMarkers(directory, markerKeysById)
  };
  map.addSource('places', {type: 'geojson', data, promoteId: 'markerKey'});
  const {names, icons} = placeLayers(placeBands(directory, config), config);
  for (const layer of [...names, ...icons]) map.addLayer(layer, 'road-labels');
  return {directory, layerIds: [...icons, ...names].map(layer => layer.id)};
}
