import {hitTest} from '@ivanov-gv/map-core';
import {isSameHandle, midpointHandles, vertexHandles} from './geometry-editing.js';

const sourceName = 'editor-handles';
const layerId = 'editor-handles-point';
// Generous so that a corner can be grabbed with a finger.
const handleHitRadiusPixels = 14;
const handleRadiusPixels = 7;
const handleStrokeWidthPixels = 2;
const handleColor = '#ffffff';
const selectedHandleColor = '#c8372d';
const midpointRadiusPixels = 5;
// A side shorter than this on screen has no room for its own handle between the two corners.
const shortestSidePixels = 48;

function handleFeature({coordinate, isMidpoint = false, polygonIndex, ringIndex, vertexIndex}, selectedHandle) {
  const handle = {vertexIndex};
  if (ringIndex !== undefined) handle.ringIndex = ringIndex;
  if (polygonIndex !== undefined) handle.polygonIndex = polygonIndex;
  const isSelected = !isMidpoint && isSameHandle(handle, selectedHandle);
  return {
    type: 'Feature',
    properties: {...handle, isMidpoint, isSelected},
    geometry: {type: 'Point', coordinates: coordinate}
  };
}

// Corners win over the middle of a side where both are in reach.
function handleOfHits(hits) {
  const hit = hits.find(({properties}) => !properties.isMidpoint) ?? hits[0];
  if (!hit) return null;
  const {polygonIndex, ringIndex, vertexIndex, isMidpoint} = hit.properties;
  const handle = {ringIndex, vertexIndex};
  if (polygonIndex !== undefined) handle.polygonIndex = polygonIndex;
  return isMidpoint ? {...handle, isMidpoint: true} : handle;
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
      'circle-radius': ['case', ['get', 'isMidpoint'], midpointRadiusPixels, handleRadiusPixels],
      'circle-opacity': ['case', ['get', 'isMidpoint'], 0.75, 1],
      'circle-color': ['case', ['get', 'isSelected'], selectedHandleColor, handleColor],
      'circle-stroke-color': selectedHandleColor,
      'circle-stroke-width': handleStrokeWidthPixels
    }
  });
  const isSideLongEnough = ({sideEnds: [start, end]}) => map.project(start).dist(map.project(end)) >= shortestSidePixels;
  return {
    show(geometry, selectedHandle) {
      const corners = geometry ? vertexHandles(geometry) : [];
      const midpoints = geometry ? midpointHandles(geometry).filter(isSideLongEnough) : [];
      const features = [...midpoints, ...corners].map(handle => handleFeature(handle, selectedHandle));
      map.getSource(sourceName).setData({type: 'FeatureCollection', features});
    },
    // The points of a shape being drawn, which are not grabbed.
    showPoints(coordinates) {
      const features = coordinates.map((coordinate, vertexIndex) => handleFeature({coordinate, vertexIndex}, null));
      map.getSource(sourceName).setData({type: 'FeatureCollection', features});
    },
    clear() {
      map.getSource(sourceName).setData({type: 'FeatureCollection', features: []});
    },
    handleAt(point) {
      return handleOfHits(hitTest(map, point, [layerId], handleHitRadiusPixels));
    }
  };
}
