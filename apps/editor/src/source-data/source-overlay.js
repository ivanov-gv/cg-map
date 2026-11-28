import {createGeoJSONOverlay} from '@ivanov-gv/map-core';
import {installInspectionLayers} from './inspection-layers.js';
import {stateColors} from '../layers/shared/object-states.js';

const sourceName = 'editor-source';
const selectionSource = `${sourceName}-selection`;
const appliedSource = 'editor-applied';
const ghostSource = 'editor-ghost';
const drawingSource = 'editor-drawing';
const deletionSource = 'editor-deletions';
const targetSource = 'editor-target';
const followingSource = 'editor-following';
const storedSource = 'editor-stored';
const overlapSource = 'editor-overlaps';
const pathSource = 'editor-path';
const sketchSource = 'editor-sketches';
const placesFile = 'places.geojson';
// Guides become useful at neighbourhood scale. Below this, select the normal rendered cartography instead.
export const guideMinZoom = 15;
const maximumZoom = 24;
const levelLabelMinZoom = 16;

const emptyCollection = () => ({type: 'FeatureCollection', features: []});
const collectionOf = features => ({type: 'FeatureCollection', features});

// A GeoJSON source parses new data in a worker, so a query or a pick can still see its previous rendered tile. Drop that
// tile as the new data is set: a moved object must not leave a stale mark at the place it just left.
function clearRenderedTiles(map, source) {
  map.style?.tileManagers?.[source]?.clearTiles?.();
}

// Display copies preserve the properties used by public cartography and add the object's state. MapLibre needs a numeric
// feature ID, so the position in the entries stands in for it here while the source feature keeps its own ID untouched.
export function overlayCollection(entries, stateOf = () => 'editable', factsOf = () => ({})) {
  const features = entries.map((entry, index) => ({
    type: 'Feature',
    id: index,
    geometry: entry.feature.geometry,
    properties: {...entry.feature.properties, ...factsOf(entry), sourceFile: entry.filename, objectState: stateOf(entry)}
  }));
  return collectionOf(features);
}

// Resolve rendered hits once in source order, preserving working keys and rejecting stale file data. Public POI markers
// carry only the IDs admitted at their current zoom, including co-located members.
export function sourceEntriesForHits(hits, entries) {
  const indices = new Set();
  const placeIndices = new Map();
  const previewIndices = new Map();
  entries.forEach(({filename, feature, key}, index) => {
    if (filename === placesFile) placeIndices.set(feature.properties.id, index);
    // The public cartography preview carries its working key, so a hit on it resolves to the same entry a guide would.
    previewIndices.set(`${filename}:${key}`, index);
  });
  for (const hit of hits) {
    if (hit?.source === 'places' && hit.properties.activeIds) {
      const visibleIndices = JSON.parse(hit.properties.activeIds).map(id => placeIndices.get(id));
      for (const index of visibleIndices.filter(index => index !== undefined)) indices.add(index);
      continue;
    }
    const selectionKey = hit?.properties?.selectionKey;
    if (selectionKey !== undefined) {
      const index = previewIndices.get(`${hit.properties.sourceFile}:${selectionKey}`);
      if (index !== undefined) indices.add(index);
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
// Shapes that only frame the map, or that another layer edits, have no guide.
const isNotContext = ['!=', ['get', 'objectState'], 'context'];
// A line has two outside rails; a polygon has just its boundary, never an interior tint.
const lineGap = widthPixels => ['case', ['==', ['geometry-type'], 'LineString'], widthPixels, 0];

function styleGuides(map) {
  map.setLayoutProperty(`${sourceName}-fill`, 'visibility', 'none');
  map.setFilter(`${sourceName}-point`, ['all', ['==', ['geometry-type'], 'Point'], isNotContext]);
  map.setPaintProperty(`${sourceName}-point`, 'circle-opacity', 0);
  map.setPaintProperty(`${sourceName}-point`, 'circle-radius', 13);
  map.setPaintProperty(`${sourceName}-point`, 'circle-stroke-color', guideColor);
  map.setPaintProperty(`${sourceName}-point`, 'circle-stroke-width', 1.5);
  map.setPaintProperty(`${sourceName}-line`, 'line-color', guideColor);
  map.setPaintProperty(`${sourceName}-line`, 'line-width', ['case', ['>', ownLevel, 0], 3, 1.5]);
  map.setPaintProperty(`${sourceName}-line`, 'line-gap-width', lineGap(6));
  map.setFilter(`${sourceName}-line`, guideFilter(null));
}

// Dashes cannot depend on a feature's data, so each dashed state has its own layer.
const dashedLine = (id, source, color, widthPixels, dashes) => ({
  id,
  type: 'line',
  source,
  paint: {'line-color': color, 'line-width': widthPixels, 'line-dasharray': dashes}
});

const ownLevel = ['coalesce', ['get', 'ownLevel'], 0];

// What is on the shown level, or everything when none is. Objects without levels are on all of them.
const isOnLevel = level =>
  level === null ? true : ['any', ['!', ['has', 'levelKeys']], ['in', `,${level},`, ['get', 'levelKeys']]];

const guideFilter = shownLevel => [
  'all',
  ['!=', ['geometry-type'], 'Point'],
  ['!=', ['get', 'objectState'], 'missing'],
  ['>=', ownLevel, 0],
  isNotContext,
  isOnLevel(shownLevel)
];
const belowGroundFilter = shownLevel => ['all', ['<', ownLevel, 0], isOnLevel(shownLevel)];
const offGroundFilter = shownLevel => ['all', ['!=', ownLevel, 0], isOnLevel(shownLevel)];

// Roads under and over others: dashed rails below the ground, strong ones above it, and the level on the line.
function levelLayers() {
  return [
    {
      id: 'editor-below-ground',
      type: 'line',
      source: sourceName,
      filter: belowGroundFilter(null),
      paint: {
        'line-color': guideColor,
        'line-width': 2,
        'line-gap-width': lineGap(6),
        'line-dasharray': [3, 2]
      }
    },
    {
      id: 'editor-level-labels',
      type: 'symbol',
      source: sourceName,
      minzoom: levelLabelMinZoom,
      filter: offGroundFilter(null),
      layout: {
        'symbol-placement': 'line-center',
        'text-field': ['case', ['>', ownLevel, 0], ['concat', '+', ['to-string', ownLevel]], ['to-string', ownLevel]],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-rotation-alignment': 'viewport',
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {'text-color': stateColors.editable, 'text-halo-color': '#ffffff', 'text-halo-width': 2.5}
    }
  ];
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

// What has been done to objects: applied, missing something or marked for deletion.
function objectStateLayers() {
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
    }
  ];
}

// Stored positions are drawn as their own marks, never as part of the object's outline and never pickable.
function storedPositionLayers() {
  return [
    dashedLine('editor-stored-line', storedSource, stateColors.sketch, 2, [2, 2]),
    {
      id: 'editor-stored-point',
      type: 'circle',
      source: storedSource,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 6,
        'circle-color': stateColors.sketch,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
      }
    }
  ];
}

// What belongs to the edit in progress, and what waits from the field.
function workLayers() {
  return [
    {
      id: 'editor-path',
      type: 'line',
      source: pathSource,
      layout: {'line-join': 'round'},
      paint: {'line-color': ['get', 'colour'], 'line-width': 5, 'line-opacity': 0.85}
    },
    {
      id: 'editor-target',
      type: 'line',
      source: targetSource,
      paint: {'line-color': stateColors.editable, 'line-width': 3}
    },
    {
      id: 'editor-following-line',
      type: 'line',
      source: followingSource,
      filter: ['!=', ['geometry-type'], 'Point'],
      layout: {'line-join': 'round'},
      paint: {'line-color': stateColors.highlighted, 'line-width': 2, 'line-opacity': 0.75}
    },
    {
      id: 'editor-overlap',
      type: 'line',
      source: overlapSource,
      paint: {'line-color': stateColors.overlap, 'line-width': 4}
    },
    {
      id: 'editor-following-point',
      type: 'circle',
      source: followingSource,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7,
        'circle-opacity': 0,
        'circle-stroke-color': stateColors.highlighted,
        'circle-stroke-width': 2
      }
    },
    // A stored label or icon position is a fact of the source, not a guide derived from the outline.
    ...storedPositionLayers(),
    {
      id: 'editor-sketch-fill',
      type: 'fill',
      source: sketchSource,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: {'fill-color': stateColors.sketch, 'fill-opacity': 0.12}
    },
    {
      ...dashedLine('editor-sketch-line', sketchSource, stateColors.sketch, 2, [3, 2]),
      filter: ['all', ['!=', ['geometry-type'], 'Point'], ['==', ['get', 'type'], 'sketch']]
    },
    {
      id: 'editor-sketch-pin',
      type: 'circle',
      source: sketchSource,
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 9,
        'circle-color': stateColors.sketch,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
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
  for (const source of [
    appliedSource,
    ghostSource,
    drawingSource,
    deletionSource,
    targetSource,
    followingSource,
    storedSource,
    overlapSource,
    pathSource,
    sketchSource
  ]) {
    map.addSource(source, {type: 'geojson', data: emptyCollection()});
  }
  const layers = [...levelLayers(), ...objectStateLayers(), ...workLayers()];
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
  const textStateLayers = ['editor-deletion-cross', 'editor-level-labels'];
  const lineStateLayers = stateLayerIds.filter(id => !textStateLayers.includes(id));
  // Text halos must also sit above the outer selection outline, not just the ordinary guides.
  for (const layerId of [...overlay.layerIds, ...lineStateLayers, ...selectionLayerIds]) {
    map.moveLayer(layerId, firstSymbol);
  }
  const guideLayerIds = [...overlay.layerIds.filter(id => !id.endsWith('-fill')), 'editor-missing', 'editor-below-ground'];
  const setData = (source, features) => map.getSource(source).setData(collectionOf(features));
  // Points keep their own filters while one level is shown.
  const pointLayerIds = [`${sourceName}-point`, 'editor-road-nodes'];
  const pointFilters = pointLayerIds.map(layerId => [layerId, map.getFilter(layerId)]);
  const setGuideMinZoom = (minimumZoom, pointMinimumZoom = minimumZoom) => {
    for (const layerId of guideLayerIds) {
      const isPointLayer = layerId === `${sourceName}-point`;
      map.setLayerZoomRange(layerId, isPointLayer ? pointMinimumZoom : minimumZoom, maximumZoom);
    }
  };
  setGuideMinZoom(guideMinZoom);
  return {
    layerIds: guideLayerIds,
    inspectionLayerIds: inspectionLayers,
    setData: collection => {
      overlay.setData(collection);
      clearRenderedTiles(map, sourceName);
    },
    setSelection: feature => {
      overlay.setSelection(feature);
      if (!feature) clearRenderedTiles(map, selectionSource);
    },
    setApplied: features => setData(appliedSource, features),
    setDeletions: features => setData(deletionSource, features),
    setTarget: feature => setData(targetSource, feature ? [feature] : []),
    setPath: (coordinates, colour = '#1b75bb') =>
      setData(pathSource, coordinates.length > 1 ? [lineFeature(coordinates, {colour})] : []),
    setSketches: features => setData(sketchSource, features),
    // What is as it was: the open object, and what goes along with it.
    setGhosts: geometries =>
      setData(ghostSource, geometries.map(geometry => ({type: 'Feature', properties: {}, geometry}))),
    // The neighbours that the open area lies over.
    setOverlaps: features =>
      setData(
        overlapSource,
        features.map(({geometry}) => ({type: 'Feature', properties: {}, geometry}))
      ),
    setFollowing: features =>
      setData(followingSource, features.map(({geometry}) => ({type: 'Feature', properties: {}, geometry}))),
    setStoredPositions: features => setData(storedSource, features),
    setDrawing: (points, nextPoint) => setData(drawingSource, drawingFeatures(points, nextPoint)),
    setGuideMinZoom,
    setShownLevel(level) {
      map.setFilter(`${sourceName}-line`, guideFilter(level));
      map.setFilter('editor-below-ground', belowGroundFilter(level));
      for (const [layerId, filter] of pointFilters) map.setFilter(layerId, ['all', filter, isOnLevel(level)]);
      map.setFilter('editor-level-labels', offGroundFilter(level));
    },
    // A filter draws no cartography of its own, so the inside of its shapes takes the taps.
    setInteriorsPickable(isPickable) {
      map.setPaintProperty(`${sourceName}-fill`, 'fill-opacity', 0);
      map.setLayoutProperty(`${sourceName}-fill`, 'visibility', isPickable ? 'visible' : 'none');
    },
    interiorLayerId: `${sourceName}-fill`,
    setGuidesVisible(isVisible) {
      for (const layerId of [...guideLayerIds, 'editor-level-labels']) {
        map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
      }
    }
  };
}
