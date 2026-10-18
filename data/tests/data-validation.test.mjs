import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCollection, validateStops, validateTransitNetwork, validateBuildingLabels} from '../tools/check-data.mjs';
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

test('house-number labels are backed by source IDs and lie inside their building polygons', () => {
  const labels=JSON.parse(fs.readFileSync('data/sources/building-labels.geojson'));
  const buildings=JSON.parse(fs.readFileSync('data/sources/buildings.geojson'));
  const provenance=JSON.parse(fs.readFileSync('data/sources/building-labels.provenance.json'));
  assert.equal(validateBuildingLabels(labels,buildings),provenance.features);
  for(const mutate of [
    data=>{data.features[0].geometry.coordinates=[19,42];},
    data=>{data.features[0].properties['addr:housenumber']='bb';},
    data=>{data.features[0].properties.footprintIndex=-1;},
    data=>{data.features[1].id=data.features[0].id;data.features[1].properties.osm_id=data.features[0].id;}
  ]) {const bad=structuredClone(labels);mutate(bad);assert.throws(()=>validateBuildingLabels(bad,buildings));}
});

test('building numbers cannot be placed inside a polygon courtyard', () => {
  const label={type:'Feature',id:'way/1',geometry:{type:'Point',coordinates:[19.5,42.5]},properties:{kind:'building',osm_id:'way/1',footprintIndex:0,'addr:housenumber':'1',address_sources:['way/1']}};
  const buildings={type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[[[19,42],[20,42],[20,43],[19,43],[19,42]],[[19.4,42.4],[19.6,42.4],[19.6,42.6],[19.4,42.6],[19.4,42.4]]]}}]};
  assert.throws(()=>validateBuildingLabels({type:'FeatureCollection',features:[label]},buildings),/outside its polygon/);
});
