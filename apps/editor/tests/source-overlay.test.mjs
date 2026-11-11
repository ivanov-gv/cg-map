import test from 'node:test';
import assert from 'node:assert/strict';
import {objectLabel, objectName, overlayCollection, sourceEntriesForHits} from '../src/source-overlay.js';

const point = {type: 'Point', coordinates: [19.2, 42.4]};
const stop = {type: 'Feature', id: 'stop:7', properties: {name: 'Stop'}, geometry: point};

test('overlay features use the index for hit testing and leave the source feature untouched', () => {
  const collection = overlayCollection('transport-stops.geojson', [stop]);
  assert.deepEqual(collection.features, [
    {type: 'Feature', id: 0, geometry: point, properties: {sourceFile: 'transport-stops.geojson'}}
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
