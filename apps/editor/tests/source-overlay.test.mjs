import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceOverlay, guideMinZoom, objectLabel, objectName, overlayCollection, sourceEntriesForHits} from '../src/source-overlay.js';

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
  const entries = [{key: '0', feature: stop}];
  assert.deepEqual(sourceEntriesForHits([hit], 'transport-stops.geojson', entries), entries);
});

test('a hit still rendered from the previous file never resolves against the active file', () => {
  const staleHit = {id: 0, properties: {sourceFile: 'buildings.geojson'}};
  assert.deepEqual(sourceEntriesForHits([staleHit], 'transport-stops.geojson', [{key: '0', feature: stop}]), []);
});

test('a missing hit or an unknown index resolves to nothing', () => {
  const outOfRangeHit = {id: 5, properties: {sourceFile: 'transport-stops.geojson'}};
  const entries = [{key: '0', feature: stop}];
  assert.deepEqual(sourceEntriesForHits([undefined], 'transport-stops.geojson', entries), []);
  assert.deepEqual(sourceEntriesForHits([outOfRangeHit], 'transport-stops.geojson', entries), []);
});

test('hit candidates deduplicate tile and outline hits and preserve working keys after a deletion', () => {
  const entries = [{key: '4', feature: stop}, {key: 'local:new', feature: {...stop, id: 'stop:8'}}];
  const hit = id => ({id, properties: {sourceFile: 'transport-stops.geojson'}});
  const hits = [hit(1), hit(0), hit(1), hit(0), hit(-1), hit(5), hit('0'),
    {id: 0, properties: {sourceFile: 'buildings.geojson'}}, undefined];
  assert.deepEqual(sourceEntriesForHits(hits, 'transport-stops.geojson', entries), entries);
  assert.deepEqual(sourceEntriesForHits([], 'transport-stops.geojson', entries), []);
});

test('object labels distinguish equal names and unnamed geometry without inventing identities', () => {
  assert.equal(objectName(stop), 'Stop');
  assert.equal(objectLabel({key: '4', feature: stop}), 'Stop · Point · feature 4');
  assert.equal(objectLabel({key: '5', feature: stop}), 'Stop · Point · feature 5');
  const unnamed = {...stop, properties: {}};
  assert.equal(objectName(unnamed), 'Unnamed');
  assert.equal(objectLabel({key: '6', feature: unnamed}), 'Unnamed · Point · feature 6');
  const address = {...stop, properties: {'addr:housenumber': '17'}};
  assert.equal(objectName(address), '17');
  assert.equal(objectLabel({key: '7', feature: address}), '17 · Point · feature 7');
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
  const hit = {source: 'places', properties: {activeIds: '["visible"]'}};
  const entries = [{key: '0', feature: hidden}, {key: '1', feature: visible}];
  assert.deepEqual(sourceEntriesForHits([hit], 'places.geojson', entries), [entries[1]]);
  assert.deepEqual(sourceEntriesForHits([hit], 'roads.geojson', entries), []);
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

test('shared public markers return every visible member once alongside guide hits', () => {
  const first = {...stop, properties: {id: 'node/1'}};
  const second = {...stop, properties: {id: 'node/2'}};
  const hidden = {...stop, properties: {id: 'node/3'}};
  const entries = [{key: '0', feature: first}, {key: '1', feature: second}, {key: '2', feature: hidden}];
  const marker = {source: 'places', properties: {activeIds: '["node/1","node/2"]'}};
  const guide = {id: 1, properties: {sourceFile: 'places.geojson'}};
  assert.deepEqual(sourceEntriesForHits([marker, guide, marker], 'places.geojson', entries), entries.slice(0, 2));
});


test('unknown activeIds on a source POI cannot change guide hit identity', () => {
  const first = {...stop, properties: {id: 'node/1', activeIds: 'not-json'}};
  const second = {...stop, properties: {id: 'node/2'}};
  const entries = [{key: '0', feature: first}, {key: '1', feature: second}];
  const malformed = {source: 'editor-source', id: 0,
    properties: {sourceFile: 'places.geojson', activeIds: 'not-json'}};
  const misleading = {...malformed, properties: {...malformed.properties, activeIds: '["node/2"]'}};
  assert.deepEqual(sourceEntriesForHits([malformed], 'places.geojson', entries), [entries[0]]);
  assert.deepEqual(sourceEntriesForHits([misleading], 'places.geojson', entries), [entries[0]]);
});
