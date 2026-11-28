// Which archive source layers carry each editable source file. These names are the data-owned tile layer contract
// (data/tools/tile-layers.mjs); the Editor keeps no copy of map-core's paint, layout, filters or zoom ranges. It finds
// the actual style layers on the map at runtime, so a style change cannot leave an edit without its public look.
// A file absent from this table has no public vector layer: its inspection layer draws it while it is being edited.
import {frameKinds, greenAreaKinds, waterAreaKinds, waterLineKinds} from '../layers/shared/surface-edits.js';

const surfaceFile = 'surface.geojson';
const labelFrameKinds = frameKinds.filter(kind => kind !== 'sea');
const sourceLayersByFile = {
  'bridges.geojson': ['bridges'],
  'buildings.geojson': ['buildings'],
  'canyon-rims.geojson': ['canyon_rims'],
  'contours.geojson': ['contours'],
  // The country and its neighbours reach the tiles through the land layer, not a separate one.
  'context-countries.geojson': ['land'],
  'land.geojson': ['land', 'green_area_labels'],
  'protected-areas.geojson': ['protected_areas', 'green_area_labels'],
  'railways.geojson': ['railways'],
  'roads.geojson': ['roads'],
  'slopes.geojson': ['slopes'],
  [surfaceFile]: [
    'land', 'green_area_labels', 'surface_labels', 'protected_areas', 'shades', 'poi_labels', 'water'
  ],
  'summits.geojson': ['summits'],
  'water.geojson': ['water']
};

// One surface file feeds several source layers. The kind decides which public layer draws it, and only the selection
// code filters kinds by the active layer. The pinned core has no shades or settlement-label layer; keeping their source
// layer names in this table lets a core that publishes them draw the stored facts without another editor mapping.
const surfaceKindsBySourceLayer = {
  land: [...greenAreaKinds, 'context'],
  protected_areas: ['protected-area'],
  shades: ['shade'],
  // Municipalities are a stored frame polygon, not green land cover: the public water fill draws their outline.
  water: [...waterAreaKinds, 'municipality', 'sea'],
  surface_labels: labelFrameKinds,
  poi_labels: ['lake']
};
// The water fill and the waterways share one archive source layer, so the published layer ID separates the area kinds
// from the line kinds. A river polygon must never reach the water fill, nor a lake the river stroke.
const surfaceKindsByPublishedLayer = {
  rivers: waterLineKinds
};
const storedGeometryBySourceLayer = {
  green_area_labels: 'labelLine',
  surface_labels: 'labelPoint',
  poi_labels: 'iconPoint'
};

function layersForFiles(layers, files) {
  const layerIdsBySourceLayer = new Map();
  for (const layer of layers) {
    if (layer.source !== 'basemap' || !layer['source-layer']) continue;
    const layerIds = layerIdsBySourceLayer.get(layer['source-layer']) ?? [];
    layerIds.push(layer.id);
    layerIdsBySourceLayer.set(layer['source-layer'], layerIds);
  }
  return Object.fromEntries(
    Object.entries(files)
      .map(([filename, sourceLayers]) => [
        filename,
        sourceLayers.flatMap(sourceLayer => layerIdsBySourceLayer.get(sourceLayer) ?? [])
      ])
      .filter(([, layerIds]) => layerIds.length > 0)
  );
}

// Maps each source file to the IDs of the published style layers that draw it. EPSG3857-independent: the source
// layer name is the only link between a reviewed GeoJSON file and a map-core style layer.
export function basemapLayersFromStyle(layers) {
  return layersForFiles(layers, sourceLayersByFile);
}

// A version 5 bundle has no synthetic preview files: the real surface file reaches every public surface layer.
export function previewLayersFromStyle(layers, bundleVersion) {
  const byFile = basemapLayersFromStyle(layers);
  return bundleVersion >= 5 ? byFile : Object.fromEntries(Object.entries(byFile).filter(([filename]) => filename !== surfaceFile));
}

// A label is stored on the object, not derived into its own file. Give the public symbol layer that stored geometry, so
// a moved label point or line is drawn where the source says it is. Every other layer draws the object's own geometry.
export function surfacePreviewFeatures(publishedLayer, features) {
  const sourceLayer = publishedLayer['source-layer'];
  const kinds = surfaceKindsByPublishedLayer[publishedLayer.id] ?? surfaceKindsBySourceLayer[sourceLayer];
  const drawn = kinds ? features.filter(({properties}) => kinds.includes(properties.kind)) : features;
  const field = storedGeometryBySourceLayer[sourceLayer];
  if (!field) return drawn;
  return drawn.flatMap(feature => {
    const coordinates = feature.properties[field];
    const isCompleteLine = field !== 'labelLine' || (Array.isArray(coordinates) && coordinates.length >= 2);
    if (!isCompleteLine || !coordinates) return [];
    return [{...feature, geometry: {type: field === 'labelLine' ? 'LineString' : 'Point', coordinates}}];
  });
}
