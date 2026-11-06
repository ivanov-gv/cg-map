import test from 'node:test';
import assert from 'node:assert/strict';
import {overlayCollection, sourceFeatureForHit} from '../src/source-overlay.js';

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
