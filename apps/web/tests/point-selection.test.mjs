import test from 'node:test';
import assert from 'node:assert/strict';
import {describePoint, endpointFeatures} from '../src/point-selection.js';
test('unnamed buildings and empty map points do not acquire invented metadata', () => {
  const building=describePoint({layer:{id:'buildings'},properties:{kind:'building'}},[19.26,42.44]);
  assert.equal(building.name,'Building');assert.deepEqual(building.coordinates,[19.26,42.44]);
  assert.equal(describePoint(null,[19,42]).name,'Map point');
  const park=describePoint({layer:{id:'land'},properties:{kind:'park',name:'Park'}},[19,42]);
  assert.equal(park.kind,'Park');
});
test('stop selection keeps source identity and point coordinates', () => {
  const stop=describePoint({layer:{id:'transport-stops'},geometry:{coordinates:[19.25,42.45]},properties:{name:'Stop',stopId:'17'}},[19,42]);
  assert.deepEqual(stop.coordinates,[19.25,42.45]);assert.ok(stop.details.includes('Stop ID: 17'));
});
test('endpoint features keep both roles and do not share mutable coordinate arrays', () => {
  const endpoints={from:{name:'A place',coordinates:[19,42]},to:{name:'B place',coordinates:[20,43]}};
  const data=endpointFeatures(endpoints);assert.equal(data.features.length,2);
  assert.deepEqual(data.features.map(f=>f.properties.label),['A','B']);
  data.features[0].geometry.coordinates[0]=0;assert.equal(endpoints.from.coordinates[0],19);
  assert.equal(endpointFeatures({}).features.length,0);
});

test('numbered building labels expose an address without inventing a building name', () => {
  const point=describePoint({layer:{id:'building-numbers'},properties:{kind:'building','addr:housenumber':'12B','addr:street':'Test street'}},[19.26,42.44]);
  assert.equal(point.kind,'Building');assert.equal(point.name,'Building 12B');assert.ok(point.details.includes('Test street 12B'));
});

test('polygon address lookup is independent of label rendering and handles footprint zero', async () => {
  const {buildingAddressIndex}=await import('../src/point-selection.js');
  const index=buildingAddressIndex({features:[{properties:{footprintIndex:0,'addr:housenumber':'12B','addr:street':'Test street'}}]});
  const feature={id:0,layer:{id:'buildings'},properties:{kind:'building'}};
  const point=describePoint(feature,[19.26,42.44],index);
  assert.equal(point.name,'Building 12B');assert.ok(point.details.includes('Test street 12B'));
  assert.equal(describePoint({...feature,id:1},[19.26,42.44],index).name,'Building');
  assert.equal(describePoint({...feature,layer:{id:'land'}},[19.26,42.44],index).kind,'Land');
  assert.equal(feature.properties['addr:housenumber'],undefined);
});
