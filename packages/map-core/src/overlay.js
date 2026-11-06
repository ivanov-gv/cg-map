const emptyCollection = () => ({type: 'FeatureCollection', features: []});
const overlayColor = '#32634d';
const selectionColor = '#c43f3f';
const overlayFillOpacity = 0.22;
const selectionFillOpacity = 0.3;

// Uniform point/line/polygon rendering for source inspection, without application edit state.
function overlayLayers(source, color, opacity) {
  return [
    {
      id: `${source}-fill`,
      type: 'fill',
      source,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {'fill-color': color, 'fill-opacity': opacity}
    },
    {
      id: `${source}-line`,
      type: 'line',
      source,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: {'line-color': color, 'line-width': 3}
    },
    {
      id: `${source}-point`,
      type: 'circle',
      source,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-color': color,
        'circle-radius': 7,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    }
  ];
}

// Accepts source GeoJSON or a hitTest result. Rendered features expose geometry through a prototype
// getter that structuredClone drops, so read the fields explicitly or the highlight never draws.
function plainFeatureCopy({geometry, properties}) {
  return structuredClone({type: 'Feature', properties, geometry});
}

// Call only after map load. Names must be unique on the map. Selection is a separate rendering
// source, so changing its appearance cannot mutate a caller's source GeoJSON or properties.
export function createGeoJSONOverlay(map, name, data = emptyCollection()) {
  const selectionName = `${name}-selection`;
  const layers = overlayLayers(name, overlayColor, overlayFillOpacity);
  const selectedLayers = overlayLayers(selectionName, selectionColor, selectionFillOpacity);
  map.addSource(name, {type: 'geojson', data});
  map.addSource(selectionName, {type: 'geojson', data: emptyCollection()});
  for (const layer of [...layers, ...selectedLayers]) map.addLayer(layer);
  return {
    layerIds: layers.map(layer => layer.id),
    setData(collection) {
      map.getSource(name).setData(collection);
    },
    setSelection(feature) {
      const features = feature ? [plainFeatureCopy(feature)] : [];
      map.getSource(selectionName).setData({type: 'FeatureCollection', features});
    },
    setVisible(isVisible) {
      for (const layer of [...layers, ...selectedLayers]) {
        map.setLayoutProperty(layer.id, 'visibility', isVisible ? 'visible' : 'none');
      }
    },
    destroy() {
      for (const layer of [...layers, ...selectedLayers].reverse()) map.removeLayer(layer.id);
      map.removeSource(selectionName);
      map.removeSource(name);
    }
  };
}
