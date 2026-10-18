import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCollection, validateStops, validateTransitNetwork} from '../tools/check-data.mjs';
const fixture = JSON.parse(fs.readFileSync('data/tests/fixtures/podgorica-places.geojson'));
test('reviewed Podgorica places satisfy the directory contract', () => {
  assert.equal(validateCollection(fixture, {places: true}), 3);
});
test('invalid coordinates, duplicate identities, and unknown categories are rejected', () => {
  for (const mutate of [
    data => {data.features[0].geometry.coordinates[1] = 120;},
    data => {data.features[1].properties.id = data.features[0].properties.id;},
    data => {data.features[0].properties.category = 'unknown';}
  ]) {
    const data = structuredClone(fixture); mutate(data);
    assert.throws(() => validateCollection(data, {places: true}));
  }
});
test('unclosed polygon rings are rejected', () => {
  assert.throws(() => validateCollection({type: 'FeatureCollection', features: [{type: 'Feature', properties: {},
    geometry: {type: 'Polygon', coordinates: [[[19,42],[20,42],[20,43],[19,43]]]}}]}), /not closed/);
});

test('bus stops preserve unique source IDs and reject invalid locations or names', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  assert.equal(validateStops(stops), 719);
  for (const mutate of [
    data => {data.features[1].properties.stopId = data.features[0].properties.stopId;},
    data => {data.features[0].geometry.coordinates = [0, 0];},
    data => {data.features[0].properties.name = '';}
  ]) {
    const data = structuredClone(stops); mutate(data);
    assert.throws(() => validateStops(data));
  }
});

test('transit network rejects missing stops, reversed times, and invalid coordinates', () => {
  const network=JSON.parse(fs.readFileSync('data/sources/transit-network.json'));
  assert.ok(validateTransitNetwork(network)>0);
  for(const mutate of [
    n=>{n.patterns[0].stops[0]='missing-stop';},
    n=>{n.patterns[0].offsets[1]=-1;},
    n=>{Object.values(n.stops)[0].coordinates=[0,0];}
  ]) {const bad=structuredClone(network);mutate(bad);assert.throws(()=>validateTransitNetwork(bad));}
});
