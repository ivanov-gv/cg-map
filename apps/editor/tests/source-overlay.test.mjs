import test from 'node:test';
import assert from 'node:assert/strict';
import {objectLabel, objectName} from '../src/object-names.js';
import {stateColors} from '../src/object-states.js';
import {createSourceOverlay, guideMinZoom, overlayCollection, sourceEntriesForHits} from '../src/source-overlay.js';

const point = {type: 'Point', coordinates: [19.2, 42.4]};
const stopsFile = 'transport-stops.geojson';
const entry = (key, feature, filename = stopsFile) => ({filename, key, feature});
const placeEntry = (key, feature) => entry(key, feature, 'places.geojson');
const stop = {type: 'Feature', id: 'stop:7', properties: {name: 'Stop'}, geometry: point};

test('overlay features use the index for hit testing and leave the source feature untouched', () => {
  const collection = overlayCollection([entry('0', stop)]);
  assert.deepEqual(collection.features, [
    {type: 'Feature', id: 0, geometry: point, properties: {name: 'Stop', sourceFile: 'transport-stops.geojson', objectState: 'editable'}}
  ]);
  assert.equal(stop.id, 'stop:7');
});

test('a hit resolves to the source feature of its own file', () => {
  const hit = {id: 0, properties: {sourceFile: 'transport-stops.geojson'}};
  const entries = [entry('0', stop)];
  assert.deepEqual(sourceEntriesForHits([hit], entries), entries);
});

test('a hit still rendered from the previous file never resolves against the active file', () => {
  const staleHit = {id: 0, properties: {sourceFile: 'buildings.geojson'}};
  assert.deepEqual(sourceEntriesForHits([staleHit], [entry('0', stop)]), []);
});

test('a missing hit or an unknown index resolves to nothing', () => {
  const outOfRangeHit = {id: 5, properties: {sourceFile: 'transport-stops.geojson'}};
  const entries = [entry('0', stop)];
  assert.deepEqual(sourceEntriesForHits([undefined], entries), []);
  assert.deepEqual(sourceEntriesForHits([outOfRangeHit], entries), []);
});

test('hit candidates deduplicate tile and outline hits and preserve working keys after a deletion', () => {
  const entries = [entry('4', stop), entry('local:new', {...stop, id: 'stop:8'})];
  const hit = id => ({id, properties: {sourceFile: 'transport-stops.geojson'}});
  const hits = [hit(1), hit(0), hit(1), hit(0), hit(-1), hit(5), hit('0'),
    {id: 0, properties: {sourceFile: 'buildings.geojson'}}, undefined];
  assert.deepEqual(sourceEntriesForHits(hits, entries), entries);
  assert.deepEqual(sourceEntriesForHits([], entries), []);
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
  const contour = {...stop, properties: {elevation: 80}};
  assert.equal(objectName(contour, 'contours.geojson'), '80 m');
});


test('working features keep cartographic properties and each carries its own state', () => {
  const changedStop = {...stop, properties: {...stop.properties, name: 'Changed'}};
  const features = [stop, changedStop];
  const entries = features.map((feature, index) => entry(String(index), feature));
  const stateOf = ({feature}) => (feature === changedStop ? 'applied' : 'editable');
  const states = overlayCollection(entries, stateOf).features.map(({properties}) => properties.objectState);
  assert.deepEqual(states, ['editable', 'applied']);
  assert.deepEqual(features.map(feature => feature.properties), [{name: 'Stop'}, {name: 'Changed'}]);
});

test('a public POI marker resolves only to its currently visible members', () => {
  const hidden = {...stop, properties: {id: 'hidden'}};
  const visible = {...stop, properties: {id: 'visible'}};
  const hit = {source: 'places', properties: {activeIds: '["visible"]'}};
  const entries = [placeEntry('0', hidden), placeEntry('1', visible)];
  assert.deepEqual(sourceEntriesForHits([hit], entries), [entries[1]]);
  const roadEntries = [entry('0', hidden, 'roads.geojson')];
  assert.deepEqual(sourceEntriesForHits([hit], roadEntries), []);
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
    getFilter: () => ['==', ['geometry-type'], 'Point'],
    setFilter: (id, filter) => { layers.find(layer => layer.id === id).filter = filter; },
    setLayerZoomRange: (id, minimum, maximum) => {
      Object.assign(layers.find(layer => layer.id === id), {minzoom: minimum, maxzoom: maximum});
    },
    moveLayer: (id, before) => {
      const [layer] = layers.splice(layers.findIndex(layer => layer.id === id), 1);
      layers.splice(layers.findIndex(layer => layer.id === before), 0, layer);
    }
  };
}

test('guides have hollow interiors, and selection keeps its own visibility', () => {
  const map = overlayMap();
  const overlay = createSourceOverlay(map);
  const layer = id => map.layers.find(layer => layer.id === id);
  assert.equal(layer('editor-source-point').paint['circle-opacity'], 0);
  assert.equal(layer('editor-source-point').minzoom, guideMinZoom);
  assert.equal(layer('editor-source-fill').layout.visibility, 'none');
  assert.equal(layer('editor-source-selection-fill').paint['fill-opacity'], 0.15, 'a picked shape is filled lightly');
  assert.equal(layer('editor-source-selection-point').paint['circle-radius'], 17);
  assert.ok(map.layers.indexOf(layer('editor-source-point')) < map.layers.indexOf(layer('normal-name')));
  assert.ok(map.layers.indexOf(layer('editor-source-selection-point')) < map.layers.indexOf(layer('normal-name')));
  overlay.setGuidesVisible(false);
  assert.equal(layer('editor-source-point').layout.visibility, 'none');
  assert.notEqual(layer('editor-source-selection-point').layout?.visibility, 'none');
  assert.notEqual(layer('editor-stops').layout?.visibility, 'none');
  assert.ok(!overlay.layerIds.includes('editor-source-fill'), 'invisible fills never take clicks');
});

test('an overlap has its own colour and carries no object state', () => {
  const map = overlayMap();
  const overlay = createSourceOverlay(map);
  const layer = map.layers.find(({id}) => id === 'editor-overlap');
  assert.equal(layer.paint['line-color'], stateColors.overlap);
  for (const [state, colour] of Object.entries(stateColors)) {
    if (state !== 'overlap') assert.notEqual(stateColors.overlap, colour, `distinct from ${state}`);
  }
  const geometry = {type: 'LineString', coordinates: [[19.2, 42.4], [19.3, 42.4]]};
  const neighbour = {type: 'Feature', properties: {name: 'Neighbour'}, geometry};
  overlay.setOverlaps([neighbour]);
  assert.deepEqual(map.sources['editor-overlaps'].data, {
    type: 'FeatureCollection',
    features: [{type: 'Feature', properties: {}, geometry}]
  });
});

test('shared public markers return every visible member once alongside guide hits', () => {
  const first = {...stop, properties: {id: 'node/1'}};
  const second = {...stop, properties: {id: 'node/2'}};
  const hidden = {...stop, properties: {id: 'node/3'}};
  const entries = [placeEntry('0', first), placeEntry('1', second), placeEntry('2', hidden)];
  const marker = {source: 'places', properties: {activeIds: '["node/1","node/2"]'}};
  const guide = {id: 1, properties: {sourceFile: 'places.geojson'}};
  assert.deepEqual(sourceEntriesForHits([marker, guide, marker], entries), entries.slice(0, 2));
});


test('unknown activeIds on a source POI cannot change guide hit identity', () => {
  const first = {...stop, properties: {id: 'node/1', activeIds: 'not-json'}};
  const second = {...stop, properties: {id: 'node/2'}};
  const entries = [placeEntry('0', first), placeEntry('1', second)];
  const malformed = {source: 'editor-source', id: 0,
    properties: {sourceFile: 'places.geojson', activeIds: 'not-json'}};
  const misleading = {...malformed, properties: {...malformed.properties, activeIds: '["node/2"]'}};
  assert.deepEqual(sourceEntriesForHits([malformed], entries), [entries[0]]);
  assert.deepEqual(sourceEntriesForHits([misleading], entries), [entries[0]]);
});
