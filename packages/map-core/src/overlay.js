// Map primitive states from the Penpot card "7 · Map primitives (Core)". Highlighted: picked, its card open.
// Editable: the Editor's objects that can be edited on the chosen layer.
const stateColors = {
  overlay: '#32634d',
  highlighted: '#c8372d',
  // The highlighted red at 15% over white, opaque, so a selected marker hides the overlay marker under it.
  highlightedMarkerFill: '#f7e1e0',
  editable: '#2e8b57',
  markerOutline: '#ffffff'
};

const emptyCollection = () => ({type: 'FeatureCollection', features: []});

// Paint for each primitive state. Default is the overlay's own look; Highlighted is a red outline over a 15% fill,
// a red edge for lines and a red ring for markers; Editable is a subtle green outline with no fill. The selection is
// drawn over the overlay, so Default lines are no wider than the Highlighted edge and leave no green fringe.
const statePaints = {
  default: {
    fillColor: stateColors.overlay,
    fillOpacity: 0.22,
    lineColor: stateColors.overlay,
    lineWidth: 2.5,
    pointColor: stateColors.overlay,
    pointOpacity: 1,
    pointStrokeColor: stateColors.markerOutline,
    pointStrokeWidth: 2
  },
  highlighted: {
    fillColor: stateColors.highlighted,
    fillOpacity: 0.15,
    lineColor: stateColors.highlighted,
    lineWidth: 2.5,
    pointColor: stateColors.highlightedMarkerFill,
    pointOpacity: 1,
    pointStrokeColor: stateColors.highlighted,
    pointStrokeWidth: 2.5
  },
  editable: {
    fillColor: stateColors.editable,
    fillOpacity: 0,
    lineColor: stateColors.editable,
    lineWidth: 1.5,
    pointColor: stateColors.editable,
    pointOpacity: 0,
    pointStrokeColor: stateColors.editable,
    pointStrokeWidth: 1.5
  }
};
const pointRadiusPixels = 7;

// Paint properties per MapLibre layer type, so a state change is the same property list as layer creation.
function layerPaints(paint) {
  return {
    fill: {'fill-color': paint.fillColor, 'fill-opacity': paint.fillOpacity},
    line: {'line-color': paint.lineColor, 'line-width': paint.lineWidth},
    circle: {
      'circle-color': paint.pointColor,
      'circle-opacity': paint.pointOpacity,
      'circle-stroke-color': paint.pointStrokeColor,
      'circle-stroke-width': paint.pointStrokeWidth
    }
  };
}

// Uniform point/line/polygon rendering for source inspection, without application edit state.
function overlayLayers(source, paint) {
  const paints = layerPaints(paint);
  return [
    {
      id: `${source}-fill`,
      type: 'fill',
      source,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: paints.fill
    },
    {
      id: `${source}-line`,
      type: 'line',
      source,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: paints.line
    },
    {
      id: `${source}-point`,
      type: 'circle',
      source,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {...paints.circle, 'circle-radius': pointRadiusPixels}
    }
  ];
}

// Accepts source GeoJSON or a hitTest result. Rendered features expose geometry through a prototype
// getter that structuredClone drops, so read the fields explicitly or the highlight never draws.
function plainFeatureCopy({geometry, properties}) {
  return structuredClone({type: 'Feature', properties, geometry});
}

// Call only after map load. Names must be unique on the map. Selection is a separate rendering
// source in the Highlighted state, so changing its appearance cannot mutate a caller's source GeoJSON or properties.
// The overlay itself starts in the Default state; setState switches it between Default and Editable.
export function createGeoJSONOverlay(map, name, data = emptyCollection()) {
  const selectionName = `${name}-selection`;
  const layers = overlayLayers(name, statePaints.default);
  const selectedLayers = overlayLayers(selectionName, statePaints.highlighted);
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
    // Highlighted belongs to the selection, so only Default and Editable apply to the whole overlay.
    setState(state) {
      if (state !== 'default' && state !== 'editable') throw new Error(`Unknown overlay state: ${state}`);
      const paints = layerPaints(statePaints[state]);
      for (const layer of layers) {
        for (const [property, value] of Object.entries(paints[layer.type])) map.setPaintProperty(layer.id, property, value);
      }
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
