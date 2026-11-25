import {createGeoJSONOverlay} from '@ivanov-gv/map-core';
import {installInspectionLayers} from './inspection-layers.js';
import {stateColors} from './object-states.js';

const sourceName = 'editor-source';
const appliedSource = 'editor-applied';
const ghostSource = 'editor-ghost';
const drawingSource = 'editor-drawing';
const deletionSource = 'editor-deletions';
const placesFile = 'places.geojson';
// Guides become useful at neighbourhood scale. Below this, select the normal rendered cartography instead.
export const guideMinZoom = 15;
const maximumZoom = 24;

const emptyCollection = () => ({type: 'FeatureCollection', features: []});
const collectionOf = features => ({type: 'FeatureCollection', features});

// Display copies preserve the properties used by public cartography and add the object's state. MapLibre needs a numeric
// feature ID, so the position in the entries stands in for it here while the source feature keeps its own ID untouched.
export function overlayCollection(entries, stateOf = () => 'editable') {
  const features = entries.map((entry, index) => ({
    type: 'Feature',
    id: index,
    geometry: entry.feature.geometry,
    properties: {...entry.feature.properties, sourceFile: entry.filename, objectState: stateOf(entry)}
  }));
  return collectionOf(features);
}

// Resolve rendered hits once in source order, preserving working keys and rejecting stale file data. Public POI markers
// carry only the IDs admitted at their current zoom, including co-located members.
export function sourceEntriesForHits(hits, entries) {
  const indices = new Set();
  const placeIndices = new Map();
  entries.forEach(({filename, feature}, index) => {
    if (filename === placesFile) placeIndices.set(feature.properties.id, index);
  });
  for (const hit of hits) {
    if (hit?.source === 'places' && hit.properties.activeIds) {
      const visibleIndices = JSON.parse(hit.properties.activeIds).map(id => placeIndices.get(id));
      for (const index of visibleIndices.filter(index => index !== undefined)) indices.add(index);
      continue;
    }
    const entry = Number.isInteger(hit?.id) ? entries[hit.id] : null;
    if (entry && hit.properties?.sourceFile === entry.filename) indices.add(hit.id);
  }
  return [...indices].sort((first, second) => first - second).map(index => entries[index]);
}

const guideColor = [
  'match',
  ['get', 'objectState'],
  'applied',
  stateColors.applied,
  'missing',
  stateColors.applied,
  stateColors.editable
];
// A line has two outside rails; a polygon has just its boundary, never an interior tint.
const lineGap = widthPixels => ['case', ['==', ['geometry-type'], 'LineString'], widthPixels, 0];

function styleGuides(map) {
  map.setLayoutProperty(`${sourceName}-fill`, 'visibility', 'none');
  map.setPaintProperty(`${sourceName}-point`, 'circle-opacity', 0);
  map.setPaintProperty(`${sourceName}-point`, 'circle-radius', 13);
  map.setPaintProperty(`${sourceName}-point`, 'circle-stroke-color', guideColor);
  map.setPaintProperty(`${sourceName}-point`, 'circle-stroke-width', 1.5);
  map.setPaintProperty(`${sourceName}-line`, 'line-color', guideColor);
  map.setPaintProperty(`${sourceName}-line`, 'line-width', 1.5);
  map.setPaintProperty(`${sourceName}-line`, 'line-gap-width', lineGap(6));
  map.setFilter(`${sourceName}-line`, [
    'all',
    ['!=', ['geometry-type'], 'Point'],
    ['!=', ['get', 'objectState'], 'missing']
  ]);
}

function styleSelection(map) {
  const selection = `${sourceName}-selection`;
  map.setPaintProperty(`${selection}-fill`, 'fill-color', stateColors.highlighted);
  map.setPaintProperty(`${selection}-fill`, 'fill-opacity', 0.15);
  map.setPaintProperty(`${selection}-point`, 'circle-opacity', 0);
  map.setPaintProperty(`${selection}-point`, 'circle-radius', 17);
  map.setPaintProperty(`${selection}-point`, 'circle-stroke-color', stateColors.highlighted);
  map.setPaintProperty(`${selection}-point`, 'circle-stroke-width', 2.5);
  map.setPaintProperty(`${selection}-line`, 'line-color', stateColors.highlighted);
  map.setPaintProperty(`${selection}-line`, 'line-width', 2.5);
  map.setPaintProperty(`${selection}-line`, 'line-gap-width', lineGap(10));
}

// Dashes cannot depend on a feature's data, so each dashed state has its own layer.
function stateLayers() {
  const dashedLine = (id, source, color, widthPixels, dashes) => ({
    id,
    type: 'line',
    source,
    paint: {'line-color': color, 'line-width': widthPixels, 'line-dasharray': dashes}
  });
  return [
    {
      ...dashedLine('editor-missing', sourceName, stateColors.applied, 1.5, [3, 2]),
      filter: ['==', ['get', 'objectState'], 'missing']
    },
    {
      id: 'editor-applied-line',
      type: 'line',
      source: appliedSource,
      filter: ['!=', ['geometry-type'], 'Point'],
      paint: {'line-color': stateColors.applied, 'line-width': 1.5, 'line-gap-width': lineGap(6)}
    },
    {
      id: 'editor-applied-point',
      type: 'circle',
      source: appliedSource,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 13,
        'circle-opacity': 0,
        'circle-stroke-color': stateColors.applied,
        'circle-stroke-width': 1.5
      }
    },
    dashedLine('editor-deletion-line', deletionSource, stateColors.highlighted, 2, [3, 2]),
    {
      id: 'editor-deletion-cross',
      type: 'symbol',
      source: deletionSource,
      layout: {
        'text-field': '×',
        'text-font': ['Open Sans Semibold'],
        'text-size': 26,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {'text-color': stateColors.highlighted, 'text-halo-color': '#ffffff', 'text-halo-width': 1.5}
    },
    dashedLine('editor-ghost', ghostSource, stateColors.ghost, 1, [3, 3]),
    {
      id: 'editor-drawing',
      type: 'line',
      source: drawingSource,
      filter: ['!', ['get', 'isRubberBand']],
      paint: {'line-color': stateColors.highlighted, 'line-width': 2.5}
    },
    {
      ...dashedLine('editor-rubber-band', drawingSource, stateColors.highlighted, 1.5, [2, 2]),
      filter: ['get', 'isRubberBand']
    }
  ];
}

const lineFeature = (coordinates, properties) => ({
  type: 'Feature',
  properties,
  geometry: {type: 'LineString', coordinates}
});

function drawingFeatures(points, nextPoint) {
  const features = [];
  if (points.length > 1) features.push(lineFeature(points, {isRubberBand: false}));
  if (points.length > 0 && nextPoint) features.push(lineFeature([points.at(-1), nextPoint], {isRubberBand: true}));
  return features;
}

function installStateLayers(map) {
  for (const source of [appliedSource, ghostSource, drawingSource, deletionSource]) {
    map.addSource(source, {type: 'geojson', data: emptyCollection()});
  }
  const layers = stateLayers();
  for (const layer of layers) map.addLayer(layer);
  return layers.map(({id}) => id);
}

// Hollow guides sit below map labels and icons. Selection stays visible even when Tools hides the guides.
export function createSourceOverlay(map) {
  const overlay = createGeoJSONOverlay(map, sourceName);
  const inspectionLayers = installInspectionLayers(map, sourceName);
  const stateLayerIds = installStateLayers(map);
  styleGuides(map);
  styleSelection(map);
  const firstSymbol = map.getStyle().layers.find(layer => layer.type === 'symbol').id;
  const selectionLayerIds = overlay.layerIds.map(id => id.replace(`${sourceName}-`, `${sourceName}-selection-`));
  const lineStateLayers = stateLayerIds.filter(id => id !== 'editor-deletion-cross');
  // Text halos must also sit above the outer selection outline, not just the ordinary guides.
  for (const layerId of [...overlay.layerIds, ...lineStateLayers, ...selectionLayerIds]) {
    map.moveLayer(layerId, firstSymbol);
  }
  const guideLayerIds = [...overlay.layerIds.filter(id => !id.endsWith('-fill')), 'editor-missing'];
  const setData = (source, features) => map.getSource(source).setData(collectionOf(features));
  const setGuideMinZoom = minimumZoom => {
    for (const layerId of guideLayerIds) map.setLayerZoomRange(layerId, minimumZoom, maximumZoom);
  };
  setGuideMinZoom(guideMinZoom);
  return {
    layerIds: guideLayerIds,
    inspectionLayerIds: inspectionLayers,
    setData: collection => overlay.setData(collection),
    setSelection: feature => overlay.setSelection(feature),
    setApplied: features => setData(appliedSource, features),
    setDeletions: features => setData(deletionSource, features),
    setGhost: geometry => setData(ghostSource, geometry ? [{type: 'Feature', properties: {}, geometry}] : []),
    setDrawing: (points, nextPoint) => setData(drawingSource, drawingFeatures(points, nextPoint)),
    setGuideMinZoom,
    setGuidesVisible(isVisible) {
      for (const layerId of guideLayerIds) {
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
      }
    }
  };
}
