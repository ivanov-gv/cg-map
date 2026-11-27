// Which archive source layers carry each editable source file. These names are the data-owned tile layer contract
// (data/tools/tile-layers.mjs); the Editor keeps no copy of map-core's paint, layout, filters or zoom ranges. It finds
// the actual style layers on the map at runtime, so a style change cannot leave an edit without its public look.
// A file absent from this table has no public vector layer: its inspection layer draws it while it is being edited.
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
  'summits.geojson': ['summits'],
  'water.geojson': ['water']
};

// Maps each source file to the IDs of the published style layers that draw it. EPSG3857-independent: the source
// layer name is the only link between a reviewed GeoJSON file and a map-core style layer.
export function basemapLayersFromStyle(layers) {
  const layerIdsBySourceLayer = new Map();
  for (const layer of layers) {
    if (layer.source !== 'basemap' || !layer['source-layer']) continue;
    const layerIds = layerIdsBySourceLayer.get(layer['source-layer']) ?? [];
    layerIds.push(layer.id);
    layerIdsBySourceLayer.set(layer['source-layer'], layerIds);
  }
  return Object.fromEntries(
    Object.entries(sourceLayersByFile)
      .map(([filename, sourceLayers]) => [
        filename,
        sourceLayers.flatMap(sourceLayer => layerIdsBySourceLayer.get(sourceLayer) ?? [])
      ])
      .filter(([, layerIds]) => layerIds.length > 0)
  );
}
