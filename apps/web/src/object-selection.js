const selectableSourceLayers = ['buildings', 'land', 'water', 'roads'];
const emptyFilter = ['==', ['id'], -1];

// Filter the original vector features instead of copying one clipped tile's
// geometry. This keeps all parts and holes selected across tile/zoom changes.
export class ObjectSelection {
  constructor(map, onBuilding = () => {}) {
    this.map = map;
    this.onBuilding = onBuilding;
    this.anchor = null;
    this.pointTarget = null;
    map.addSource('point-selection', {type: 'geojson', data: {type: 'FeatureCollection', features: []}});
    map.addLayer({
      id: 'point-selection-indicator',
      type: 'circle',
      source: 'point-selection',
      paint: {
        'circle-radius': 8,
        'circle-color': '#c43f3f',
        'circle-opacity': 0.25,
        'circle-stroke-color': '#c43f3f',
        'circle-stroke-width': 2.5
      }
    });
    for (const layer of ['place-highlight', 'transport-stops']) {
      for (const [property, value] of Object.entries({
        'circle-color': '#c43f3f',
        'circle-opacity': 0.25,
        'circle-stroke-color': '#c43f3f',
        'circle-stroke-width': 3
      })) {
        const original = map.getPaintProperty(layer, property) ?? 1;
        map.setPaintProperty(layer, property, [
          'case',
          [
            'any',
            ['boolean', ['feature-state', 'selected'], false],
            ['boolean', ['feature-state', 'preview'], false]
          ],
          value,
          original
        ]);
      }
    }
    for (const sourceLayer of selectableSourceLayers) {
      const base = {source: 'basemap', 'source-layer': sourceLayer, filter: emptyFilter};
      map.addLayer(
        {
          ...base,
          id: `selected-${sourceLayer}-fill`,
          type: 'fill',
          filter: ['all', emptyFilter, ['==', ['geometry-type'], 'Polygon']],
          paint: {'fill-color': '#c43f3f', 'fill-opacity': 0.2}
        },
        'road-labels'
      );
      map.addLayer(
        {
          ...base,
          id: `selected-${sourceLayer}-outline`,
          type: 'line',
          paint: {'line-color': '#c43f3f', 'line-width': 2.5},
          layout: {'line-join': 'round', 'line-cap': 'round'}
        },
        'road-labels'
      );
    }
    map.on('idle', () => this.resolveAnchor());
  }
  // The leading search match keeps the same ring, at any zoom, until a listing is chosen or the filter clears.
  setPreview(markerKey) {
    if (this.previewKey === markerKey) return;
    if (this.previewKey != null)
      this.map.setFeatureState({source: 'places', id: this.previewKey}, {preview: false});
    this.previewKey = markerKey;
    if (markerKey != null) this.map.setFeatureState({source: 'places', id: markerKey}, {preview: true});
  }
  clearPoint() {
    if (this.pointTarget) this.map.setFeatureState(this.pointTarget, {selected: false});
    this.pointTarget = null;
    this.map.getSource('point-selection').setData({type: 'FeatureCollection', features: []});
  }
  clear() {
    this.anchor = null;
    this.clearPoint();
    this.setTarget(null);
  }
  selectPoint(source, id) {
    this.pointTarget = {source, id};
    this.map.setFeatureState(this.pointTarget, {selected: true});
  }
  setTarget(target) {
    this.onBuilding(target?.sourceLayer === 'buildings' ? target.id : null);
    for (const sourceLayer of selectableSourceLayers) {
      const filter = target?.sourceLayer === sourceLayer ? ['==', ['id'], target.id] : emptyFilter;
      this.map.setFilter(`selected-${sourceLayer}-fill`, [
        'all',
        filter,
        ['==', ['geometry-type'], 'Polygon']
      ]);
      this.map.setFilter(`selected-${sourceLayer}-outline`, filter);
    }
  }
  // Label and entrance hits refer back to the original footprint instead of selecting a point copy.
  select(feature, coordinates) {
    this.clear();
    const buildingLayers = [
      'building-numbers',
      'entrance-points',
      'entrance-numbers',
      'entrance-selection-numbers',
      'entrance-selection-arrows'
    ];
    const isBuildingLabel = buildingLayers.includes(feature?.layer?.id);
    const sourceLayer = isBuildingLabel
      ? 'buildings'
      : (feature?.sourceLayer ?? feature?.layer?.['source-layer']);
    const identifier = isBuildingLabel ? feature.properties.footprintIndex : feature?.id;
    if (selectableSourceLayers.includes(sourceLayer) && Number.isInteger(identifier)) {
      this.setTarget({sourceLayer, id: identifier});
      return;
    }
    const source = feature?.source ?? feature?.layer?.source;
    if (['places', 'transport-stops'].includes(source) && feature.id !== undefined) {
      this.selectPoint(source, feature.id);
      return;
    }
    if (!feature && coordinates) {
      this.map.getSource('point-selection').setData({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {type: 'Point', coordinates: [...coordinates]}
          }
        ]
      });
    }
  }
  selectPlace(feature, markerKey) {
    this.clear();
    this.selectPoint('places', markerKey);
    this.anchor = [...feature.geometry.coordinates];
    this.resolveAnchor();
  }
  resolveAnchor() {
    if (!this.anchor || this.map.getZoom() < 13) return;
    const point = this.map.project(this.anchor);
    const canvas = this.map.getCanvas();
    if (point.x < 0 || point.y < 0 || point.x > canvas.clientWidth || point.y > canvas.clientHeight) return;
    const building = this.map.queryRenderedFeatures(point, {layers: ['buildings']})[0];
    if (building) this.select(building);
  }
}
