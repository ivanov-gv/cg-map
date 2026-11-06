import test from 'node:test';
import assert from 'node:assert/strict';
import {describePoint, endpointFeatures, buildingNumber, buildingAddress, buildingAddressIndex, buildingMapFeatures, entranceFeatures, selectBuildingEntrances} from '../src/point-selection.js';
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
  const index=buildingAddressIndex({type:'FeatureCollection',features:[{properties:{footprintIndex:0,'addr:housenumber':'12B','addr:street':'Test street'}}]});
  const feature={id:0,layer:{id:'buildings'},properties:{kind:'building'}};
  const point=describePoint(feature,[19.26,42.44],index);
  assert.equal(point.name,'Building 12B');assert.ok(point.details.includes('Test street 12B'));
  assert.equal(describePoint({...feature,id:1},[19.26,42.44],index).name,'Building');
  assert.equal(describePoint({...feature,layer:{id:'land'}},[19.26,42.44],index).kind,'Land');
  assert.equal(feature.properties['addr:housenumber'],undefined);
});

const entrance = (id, number, extra = {}) => ({
  id: `node/${id}`,
  coordinates: [19.26, 42.44],
  bearing: 0,
  ...(number ? { number } : {}),
  ...extra,
});

test('building and entrance numbers have independent address semantics', () => {
  const cases = [
    [{ entrances: [entrance(1, '27')] }, '27', 'Ulica Slobode 27'],
    [
      { entrances: [entrance(2, '32'), entrance(1, '27'), entrance(3, '29')] },
      '27-32',
      'Ulica Slobode 27-32',
    ],
    [
      {
        building_number: '1',
        entrances: [entrance(1, '27'), entrance(2, '32')],
      },
      'Zgrada 1, 27-32',
      'Ulica Slobode, Zgrada 1, 27-32',
    ],
    [
      {
        building_number: 'N',
        lamela: 'P',
        entrances: [entrance(1, '27', { ref: 'M' })],
      },
      'Zgrada N, Lamela P, 27',
      'Ulica Slobode, Zgrada N, Lamela P, 27',
    ],
    [
      { building_number: '1', entrances: [] },
      'Zgrada 1',
      'Ulica Slobode, Zgrada 1',
    ],
    [{ entrances: [entrance(1), entrance(2)] }, '', 'Ulica Slobode'],
    [
      { 'addr:housenumber': '27', lamela: 'P' },
      '27, Lamela P',
      'Ulica Slobode 27, Lamela P',
    ],
    [{ 'addr:housenumber': '105,107' }, '105,107', 'Ulica Slobode 105,107'],
    [
      { entrances: [entrance(1, '12B'), entrance(2, '12A')] },
      '12A, 12B',
      'Ulica Slobode 12A, 12B',
    ],
    [
      { entrances: [entrance(1, '9'), entrance(2, '10')] },
      '9-10',
      'Ulica Slobode 9-10',
    ],
  ];
  for (const [extra, label, address] of cases) {
    const properties = { 'addr:street': 'Ulica Slobode', ...extra };
    assert.equal(buildingNumber(properties), label);
    assert.equal(buildingAddress(properties), address);
  }
});

test('entrance street addresses stay separate rather than forming a cross-street range', () => {
  const properties = {
    entrances: [
      entrance(1, '27', { street: 'First' }),
      entrance(2, '32', { street: 'Second' }),
    ],
  };
  assert.equal(buildingAddress(properties), 'First 27; Second 32');
  assert.equal(
    buildingAddress({ entrances: [properties.entrances[0]] }),
    'First 27',
  );
  assert.equal(
    buildingAddress({
      'addr:street': 'First',
      entrances: [entrance(1, '27', { street: 'Second' })],
    }),
    'Second 27',
  );
  assert.equal(
    buildingAddress({
      entrances: [entrance(1, '27'), entrance(2, '32', { street: 'Second' })],
    }),
    '27; Second 32',
  );
});

test('building selection, entrance selection and map labels use the same reviewed addresses', () => {
  const properties = {
    kind: 'building',
    footprintIndex: 0,
    'addr:street': 'Ulica Slobode',
    building_number: '1',
    entrances: [
      entrance(1, '27', { ref: 'M', lamela: 'P' }),
      entrance(2, '32'),
    ],
  };
  const labels = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [19.26, 42.44] },
        properties: properties,
      },
    ],
  };
  const index = buildingAddressIndex(labels),
    features = entranceFeatures(labels);
  assert.equal(
    buildingMapFeatures(labels).features[0].properties.display_number,
    'Zgrada 1, 27-32',
  );
  assert.equal(features.features.length, 2);
  const point = describePoint(
    {
      ...features.features[0],
      id: 999,
      geometry: { type: 'Point', coordinates: [19.26001, 42.44001] },
      layer: { id: 'entrance-numbers' },
    },
    [19, 42],
    index,
  );
  assert.equal(point.kind, 'Entrance');
  assert.equal(point.name, '27, Ulaz M, Lamela P');
  assert.deepEqual(point.coordinates, [19.26, 42.44]);
  assert.ok(point.details.includes('Ulica Slobode, Zgrada 1, 27'));
  const building = describePoint(
    { id: 0, layer: { id: 'buildings' } },
    [19, 42],
    index,
  );
  assert.equal(building.name, 'Building Zgrada 1, 27-32');
  assert.ok(building.details.includes('Entrance: 27, Ulaz M, Lamela P'));
  features.features[0].geometry.coordinates[0] = 0;
  assert.equal(properties.entrances[0].coordinates[0], 19.26);
});

test('malformed or multiply assigned entrance metadata fails at the browser boundary', () => {
  const labels = {
    type: 'FeatureCollection',
    features: [
      { properties: { footprintIndex: 0, entrances: [entrance(1, '27')] } },
    ],
  };
  for (const change of [
    (properties) => { delete properties.entrances[0].bearing; },
    (properties) => { properties.entrances[0].bearing = 360; },
    (properties) => {
      properties.entrances[0].coordinates = [200, 42];
    },
    (properties) => {
      properties.entrances[0].number = 'bb';
    },
    (properties) => {
      properties.entrances.push(properties.entrances[0]);
    },
    (properties) => {
      properties.entrances = '{}';
    },
    (properties) => {
      properties.building_number = ' ';
    },
  ]) {
    const bad = structuredClone(labels);
    change(bad.features[0].properties);
    assert.throws(() => buildingAddressIndex(bad));
  }
  const bad = structuredClone(labels);
  bad.features.push({
    properties: { ...bad.features[0].properties, footprintIndex: 1 },
  });
  assert.throws(() => buildingAddressIndex(bad), /multiple buildings/);
});

test('selected entrance filters clear on deselection and avoid duplicate labels', () => {
  const filters = new Map(),
    map = { setFilter: (id, filter) => filters.set(id, filter) };
  selectBuildingEntrances(map, 0);
  assert.deepEqual(filters.get('entrance-selection-arrows'), [
    '==',
    ['get', 'footprintIndex'],
    0,
  ]);
  assert.deepEqual(filters.get('entrance-numbers'), [
    '!=',
    ['get', 'footprintIndex'],
    0,
  ]);
  selectBuildingEntrances(map, null);
  assert.deepEqual(filters.get('entrance-selection-arrows'), [
    '==',
    ['get', 'footprintIndex'],
    -1,
  ]);
});
