import {createGeoJSONOverlay} from '@ivanov-gv/map-core';

// Display copies preserve the properties used by public cartography and add guide state. MapLibre needs a numeric feature ID,
// so the array index stands in for it here while the source feature keeps its own ID untouched.
export function overlayCollection(filename, features, changedFeatures = new Set()) {
  const displayFeatures = features.map((feature, index) => ({
    type: 'Feature',
    id: index,
    geometry: feature.geometry,
    properties: {...feature.properties, sourceFile: filename, isChanged: changedFeatures.has(feature)}
  }));
  return {type: 'FeatureCollection', features: displayFeatures};
}

// Resolve rendered hits once in source order, preserving working keys and rejecting stale file data.
// Public POI markers carry only the IDs admitted at their current zoom, including co-located members.
export function sourceEntriesForHits(hits, filename, entries) {
  const indices = new Set();
  const placeIndices = filename === 'places.geojson'
    ? new Map(entries.map((entry, index) => [entry.feature.properties.id, index]))
    : new Map();
  for (const hit of hits) {
    if (filename === 'places.geojson' && hit?.source === 'places' && hit.properties.activeIds) {
      const visibleIndices = JSON.parse(hit.properties.activeIds).map(id => placeIndices.get(id));
      for (const index of visibleIndices.filter(index => index !== undefined)) indices.add(index);
      continue;
    }
    if (hit?.properties?.sourceFile !== filename) continue;
    if (!Number.isInteger(hit.id) || !entries[hit.id]) continue;
    indices.add(hit.id);
  }
  return [...indices].sort((first, second) => first - second).map(index => entries[index]);
}

// The inspector and object list share one display name; geometry and revision keys belong in list context only.
export function objectName(feature) {
  const properties = feature.properties;
  return properties.name || properties['addr:housenumber'] || 'Unnamed';
}

// Geometry and the revision-bound key distinguish unnamed objects and names shared by several sources.
export function objectLabel({key, feature}) {
  const name = objectName(feature);
  return `${name} · ${feature.geometry.type} · feature ${key}`;

}

const guideColor = ['case', ['get', 'isChanged'], '#a66a12', '#32634d'];
const selectionColor = '#2c6fb0';
// Guides become useful at neighbourhood scale. Below this, select the normal rendered cartography instead.
export const guideMinZoom = 15;

// Hollow guides sit below map labels and icons. Selection stays visible even when Tools hides the guides.
export function createSourceOverlay(map) {
  const overlay = createGeoJSONOverlay(map, 'editor-source');
  const inspectionLayers = installInspectionLayers(map);
  for (const prefix of ['editor-source', 'editor-source-selection']) {
    const isSelection = prefix.endsWith('selection');
    const color = isSelection ? selectionColor : guideColor;
    map.setLayoutProperty(`${prefix}-fill`, 'visibility', 'none');
    map.setPaintProperty(`${prefix}-point`, 'circle-opacity', 0);
    map.setPaintProperty(`${prefix}-point`, 'circle-radius', isSelection ? 17 : 13);
    map.setPaintProperty(`${prefix}-point`, 'circle-stroke-color', color);
    map.setPaintProperty(`${prefix}-point`, 'circle-stroke-width', isSelection ? 2.5 : 1.5);
    map.setPaintProperty(`${prefix}-line`, 'line-color', color);
    map.setPaintProperty(`${prefix}-line`, 'line-width', isSelection ? 3 : 1.5);
    // A line has two outside rails; a polygon has just its boundary, never an interior tint.
    map.setPaintProperty(`${prefix}-line`, 'line-gap-width',
      ['case', ['==', ['geometry-type'], 'LineString'], isSelection ? 10 : 6, 0]);
  }
  map.setLayerZoomRange('editor-source-point', guideMinZoom, 24);
  map.setLayerZoomRange('editor-source-line', guideMinZoom, 24);
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol').id;
  const selectionLayerIds = overlay.layerIds.map(id => id.replace('editor-source-', 'editor-source-selection-'));
  // Text halos must also sit above the outer selection outline, not just the ordinary guides.
  for (const layerId of [...overlay.layerIds, ...selectionLayerIds]) map.moveLayer(layerId, firstSymbol);
  return {
    layerIds: overlay.layerIds.filter(id => !id.endsWith('-fill')),
    inspectionLayerIds: inspectionLayers,
    setData: collection => overlay.setData(collection),
    setSelection: feature => overlay.setSelection(feature),
    setGuidesVisible(isVisible) {
      for (const layerId of overlay.layerIds.filter(id => !id.endsWith('-fill'))) {
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
      }
    }
  };
}

// These read-only files have no layer in map-core's base style. Give stops their own symbols and names and countries
// an outline, so turning off edit guides never removes the only rendering of an inspectable object.
function installInspectionLayers(map) {
  const stopFilter = ['==', ['get', 'sourceFile'], 'transport-stops.geojson'];
  const layers = [
    {
      id: 'editor-stops', type: 'circle', source: 'editor-source', filter: stopFilter, minzoom: 12,
      paint: {'circle-radius': 4, 'circle-color': '#2c6fb0', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5}
    },
    {
      id: 'editor-stop-names', type: 'symbol', source: 'editor-source', filter: stopFilter, minzoom: 14,
      layout: {'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 11,
        'text-anchor': 'top', 'text-offset': [0, 1.4]},
      paint: {'text-color': '#304c3e', 'text-halo-color': '#fffff9', 'text-halo-width': 2}
    },
    {
      id: 'editor-country-outlines', type: 'line', source: 'editor-source',
      filter: ['==', ['get', 'sourceFile'], 'context-countries.geojson'],
      paint: {'line-color': '#aeac98', 'line-width': 1}
    }
  ];
  for (const layer of layers) map.addLayer(layer);
  return layers.map(layer => layer.id);
}
