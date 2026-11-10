import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceOverlay, overlayCollection, sourceFeatureForHit, guideMinZoom} from '../src/source-overlay.js';

const point = {type: 'Point', coordinates: [19.2, 42.4]};
const stop = {type: 'Feature', id: 'stop:7', properties: {name: 'Stop'}, geometry: point};

test('overlay features use the index for hit testing and leave the source feature untouched', () => {
  const collection = overlayCollection('transport-stops.geojson', [stop]);
  assert.deepEqual(collection.features, [
    {type: 'Feature', id: 0, geometry: point, properties: {name: 'Stop', sourceFile: 'transport-stops.geojson', isChanged: false}}
  ]);
  assert.equal(stop.id, 'stop:7');
});

test('a hit resolves to the source feature of its own file', () => {
  const hit = {id: 0, properties: {sourceFile: 'transport-stops.geojson'}};
  assert.equal(sourceFeatureForHit(hit, 'transport-stops.geojson', [stop]), stop);
});

test('a hit still rendered from the previous file never resolves against the active file', () => {
  const staleHit = {id: 0, properties: {sourceFile: 'buildings.geojson'}};
  assert.equal(sourceFeatureForHit(staleHit, 'transport-stops.geojson', [stop]), null);
});

test('a missing hit or an unknown index resolves to nothing', () => {
  const outOfRangeHit = {id: 5, properties: {sourceFile: 'transport-stops.geojson'}};
  assert.equal(sourceFeatureForHit(undefined, 'transport-stops.geojson', [stop]), null);
  assert.equal(sourceFeatureForHit(outOfRangeHit, 'transport-stops.geojson', [stop]), null);
});


test('working features keep cartographic properties and only applied changes carry amber guide state', () => {
  const changedStop = {...stop, properties: {...stop.properties, name: 'Changed'}};
  const features = [stop, changedStop];
  const collection = overlayCollection('transport-stops.geojson', features, new Set([changedStop]));
  assert.deepEqual(collection.features.map(feature => feature.properties.isChanged), [false, true]);
  assert.deepEqual(features.map(feature => feature.properties), [{name: 'Stop'}, {name: 'Changed'}]);
});

test('a public POI marker resolves only to its currently visible members', () => {
  const hidden = {...stop, properties: {id: 'hidden'}};
  const visible = {...stop, properties: {id: 'visible'}};
  const hit = {properties: {activeIds: '["visible"]'}};
  assert.equal(sourceFeatureForHit(hit, 'places.geojson', [hidden, visible]), visible);
  assert.equal(sourceFeatureForHit(hit, 'roads.geojson', [visible]), null);
});

// Records style operations without a DOM or rendering engine.
function overlayMap() {
  const layers = [{id: 'normal-name', type: 'symbol'}];
  const sources = {};
  return {
    layers, sources,
    addSource: (id, source) => { sources[id] = source; },
    getSource: id => ({setData: data => { sources[id].data = data; }}),
    addLayer: layer => layers.push(layer),
    getStyle: () => ({layers}),
    setLayoutProperty: (id, property, value) => {
      const layer = layers.find(layer => layer.id === id);
      layer.layout = {...layer.layout, [property]: value};
    },
    setPaintProperty: (id, property, value) => {
      const layer = layers.find(layer => layer.id === id);
      layer.paint[property] = value;
    },
    setLayerZoomRange: (id, minimum, maximum) => {
      Object.assign(layers.find(layer => layer.id === id), {minzoom: minimum, maxzoom: maximum});
    },
    moveLayer: (id, before) => {
      const [layer] = layers.splice(layers.findIndex(layer => layer.id === id), 1);
      layers.splice(layers.findIndex(layer => layer.id === before), 0, layer);
    }
  };
}

test('guides and selection have hollow interiors and independent visibility', () => {
  const map = overlayMap();
  const overlay = createSourceOverlay(map);
  const layer = id => map.layers.find(layer => layer.id === id);
  assert.equal(layer('editor-source-point').paint['circle-opacity'], 0);
  assert.equal(layer('editor-source-point').minzoom, guideMinZoom);
  assert.equal(layer('editor-source-fill').layout.visibility, 'none');
  assert.equal(layer('editor-source-selection-fill').layout.visibility, 'none');
  assert.equal(layer('editor-source-selection-point').paint['circle-radius'], 17);
  assert.ok(map.layers.indexOf(layer('editor-source-point')) < map.layers.indexOf(layer('normal-name')));
  assert.ok(map.layers.indexOf(layer('editor-source-selection-point')) < map.layers.indexOf(layer('normal-name')));
  overlay.setGuidesVisible(false);
  assert.equal(layer('editor-source-point').layout.visibility, 'none');
  assert.notEqual(layer('editor-source-selection-point').layout?.visibility, 'none');
  assert.notEqual(layer('editor-stops').layout?.visibility, 'none');
  assert.ok(!overlay.layerIds.includes('editor-source-fill'), 'invisible fills never take clicks');
});
