// Highlights what the card describes. Geographic objects are highlighted by filtering the original vector features
// instead of copying one clipped tile's geometry, so all parts and holes stay selected across tile and zoom changes.
// Markers use feature state; a bare map point gets its own indicator.
const selectableSourceLayers = ['buildings', 'land', 'water', 'roads'];
// Layers whose features stand for a building footprint they name in footprintIndex.
const buildingLabelLayers = [
  'building-numbers',
  'entrance-points',
  'entrance-numbers',
  'entrance-selection-numbers',
  'entrance-selection-arrows'
];
const markerSources = ['places', 'transport-stops'];
const matchesNothing = ['==', ['id'], -1];
const isPolygon = ['==', ['geometry-type'], 'Polygon'];
const selectionColor = '#c43f3f';
const selectedMarkerPaint = {
  'circle-color': selectionColor,
  'circle-opacity': 0.25,
  'circle-stroke-color': selectionColor,
  'circle-stroke-width': 3
};
// The basemap's buildings layer starts here, so no footprint can be found below it.
const footprintMinZoom = 13;

const emptyCollection = () => ({type: 'FeatureCollection', features: []});

export class ObjectSelection {
  // onBuilding(footprintIndex or null) runs on every highlight change, including repeated clears.
  constructor(map, onBuilding = () => {}) {
    this.map = map;
    this.onBuilding = onBuilding;
    // A selected place's coordinates, waiting for its building to render.
    this.anchor = null;
    this.pointTarget = null;
    this.previewKey = undefined;
    this.#installLayers();
    map.on('idle', () => this.resolveAnchor());
  }

  #installLayers() {
    const map = this.map;
    map.addSource('point-selection', {type: 'geojson', data: emptyCollection()});
    map.addLayer({
      id: 'point-selection-indicator',
      type: 'circle',
      source: 'point-selection',
      paint: {
        'circle-radius': 8,
        'circle-color': selectionColor,
        'circle-opacity': 0.25,
        'circle-stroke-color': selectionColor,
        'circle-stroke-width': 2.5
      }
    });
    const isMarked = ['any', ['boolean', ['feature-state', 'selected'], false], ['boolean', ['feature-state', 'preview'], false]];
    for (const layer of ['place-highlight', 'transport-stops']) {
      for (const [property, selectedValue] of Object.entries(selectedMarkerPaint)) {
        const original = map.getPaintProperty(layer, property) ?? 1;
        map.setPaintProperty(layer, property, ['case', isMarked, selectedValue, original]);
      }
    }
    for (const sourceLayer of selectableSourceLayers) {
      const base = {source: 'basemap', 'source-layer': sourceLayer, filter: matchesNothing};
      map.addLayer(
        {
          ...base,
          id: `selected-${sourceLayer}-fill`,
          type: 'fill',
          filter: ['all', matchesNothing, isPolygon],
          paint: {'fill-color': selectionColor, 'fill-opacity': 0.2}
        },
        'road-labels'
      );
      map.addLayer(
        {
          ...base,
          id: `selected-${sourceLayer}-outline`,
          type: 'line',
          paint: {'line-color': selectionColor, 'line-width': 2.5},
          layout: {'line-join': 'round', 'line-cap': 'round'}
        },
        'road-labels'
      );
    }
  }

  // The leading search match keeps the same ring, at any zoom, until a listing is chosen or the filter clears.
  setPreview(markerKey) {
    if (this.previewKey === markerKey) return;
    if (this.previewKey != null) this.map.setFeatureState({source: 'places', id: this.previewKey}, {preview: false});
    this.previewKey = markerKey;
    if (markerKey != null) this.map.setFeatureState({source: 'places', id: markerKey}, {preview: true});
  }

  clearPoint() {
    if (this.pointTarget) this.map.setFeatureState(this.pointTarget, {selected: false});
    this.pointTarget = null;
    this.map.getSource('point-selection').setData(emptyCollection());
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

  // target is {sourceLayer, id} of a basemap feature, or null to highlight nothing.
  setTarget(target) {
    this.onBuilding(target?.sourceLayer === 'buildings' ? target.id : null);
    for (const sourceLayer of selectableSourceLayers) {
      const filter = target?.sourceLayer === sourceLayer ? ['==', ['id'], target.id] : matchesNothing;
      this.map.setFilter(`selected-${sourceLayer}-fill`, ['all', filter, isPolygon]);
      this.map.setFilter(`selected-${sourceLayer}-outline`, filter);
    }
  }

  // Label and entrance hits refer back to the original footprint instead of selecting a point copy.
  // feature is a rendered feature, or null for a bare map point at coordinates.
  select(feature, coordinates) {
    this.clear();
    const isBuildingLabel = buildingLabelLayers.includes(feature?.layer?.id);
    const sourceLayer = isBuildingLabel ? 'buildings' : (feature?.sourceLayer ?? feature?.layer?.['source-layer']);
    const identifier = isBuildingLabel ? feature.properties.footprintIndex : feature?.id;
    if (selectableSourceLayers.includes(sourceLayer) && Number.isInteger(identifier)) {
      this.setTarget({sourceLayer, id: identifier});
      return;
    }
    const source = feature?.source ?? feature?.layer?.source;
    if (markerSources.includes(source) && feature.id !== undefined) {
      this.selectPoint(source, feature.id);
      return;
    }
    if (!feature && coordinates) {
      const indicator = {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [...coordinates]}};
      this.map.getSource('point-selection').setData({type: 'FeatureCollection', features: [indicator]});
    }
  }

  // A listing highlights its marker now and its building once that renders at its coordinates.
  selectPlace(feature, markerKey) {
    this.clear();
    this.selectPoint('places', markerKey);
    this.anchor = [...feature.geometry.coordinates];
    this.resolveAnchor();
  }

  resolveAnchor() {
    if (!this.anchor || this.map.getZoom() < footprintMinZoom) return;
    const point = this.map.project(this.anchor);
    const canvas = this.map.getCanvas();
    const isOnScreen = point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
    if (!isOnScreen) return;
    const [building] = this.map.queryRenderedFeatures(point, {layers: ['buildings']});
    if (building) this.select(building);
  }
}
