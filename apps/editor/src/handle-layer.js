import {hitTest} from '../../../packages/map-core/src/index.js';
import {vertexHandles} from './geometry-editing.js';

const sourceName = 'editor-handles';
const layerId = 'editor-handles-point';
// Generous so that a corner can be grabbed with a finger.
const handleHitRadiusPixels = 14;
const handleRadiusPixels = 7;
const handleStrokeWidthPixels = 2;
const handleColor = '#ffffff';
const selectedHandleColor = '#c43f3f';

function handleFeature({ringIndex, vertexIndex, coordinate}, selectedHandle) {
  const isSelected = selectedHandle?.ringIndex === ringIndex && selectedHandle?.vertexIndex === vertexIndex;
  const properties = {vertexIndex, isSelected};
  if (ringIndex !== undefined) properties.ringIndex = ringIndex;
  return {type: 'Feature', properties, geometry: {type: 'Point', coordinates: coordinate}};
}

// The grabbable corners and line points of the feature being edited. Separate from the overlay so that a handle can
// never be mistaken for a source feature.
export function createHandleLayer(map) {
  map.addSource(sourceName, {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
  map.addLayer({
    id: layerId,
    type: 'circle',
    source: sourceName,
    paint: {
      'circle-radius': handleRadiusPixels,
      'circle-color': ['case', ['get', 'isSelected'], selectedHandleColor, handleColor],
      'circle-stroke-color': selectedHandleColor,
      'circle-stroke-width': handleStrokeWidthPixels
    }
  });
  return {
    show(geometry, selectedHandle) {
      const features = geometry ? vertexHandles(geometry).map(handle => handleFeature(handle, selectedHandle)) : [];
      map.getSource(sourceName).setData({type: 'FeatureCollection', features});
    },
    clear() {
      map.getSource(sourceName).setData({type: 'FeatureCollection', features: []});
    },
    handleAt(point) {
      const [hit] = hitTest(map, point, [layerId], handleHitRadiusPixels);
      return hit ? {ringIndex: hit.properties.ringIndex, vertexIndex: hit.properties.vertexIndex} : null;
    }
  };
}
