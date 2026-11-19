import test from 'node:test';
import assert from 'node:assert/strict';
import {buildObjectCard, buildPlaceCard, formatCoordinates, openingHourRows} from '../src/place-details.js';
import {describePoint, placesInsideFootprint} from '../src/point-selection.js';

const sectionById = (card, id) => card.sections.find(section => section.id === id);
const rowByLabel = (section, label) => section.rows.find(row => row.label === label);

test('coordinates use latitude first and reject incomplete positions', () => {
  assert.equal(formatCoordinates([19.262, 42.441]), '42.44100° N, 19.26200° E');
  assert.equal(formatCoordinates([-19.262, -42.441]), '42.44100° S, 19.26200° W');
  assert.equal(formatCoordinates([19.262]), '');
  assert.equal(formatCoordinates(['19.262', 42.441]), '');
});

test('supported opening hours become day rows; unsupported expressions stay raw', () => {
  assert.deepEqual(openingHourRows('Mo-Fr 07:00-23:00; Sa 08:00-14:00'), [
    {label: 'Monday – Friday', value: '07:00–23:00'},
    {label: 'Saturday', value: '08:00–14:00'}
  ]);
  assert.deepEqual(openingHourRows('Mo-Sa 08:00-20:00; Su'), [
    {label: '', value: 'Mo-Sa 08:00-20:00; Su'}
  ]);
  assert.deepEqual(openingHourRows(undefined), []);
});

test('a POI card exposes only recorded facts and the containing building', () => {
  const feature = {
    geometry: {type: 'Point', coordinates: [19.262839, 42.439658]},
    properties: {
      id: 'node/308967902',
      name: 'Mimoza',
      category: 'food',
      kind: 'cafe',
      source: 'OpenStreetMap',
      'addr:street': 'Njegoševa',
      'addr:housenumber': '12',
      phone: '+382 20 123 456',
      website: 'https://mimoza.example/',
      opening_hours: 'Mo-Fr 07:00-23:00'
    }
  };
  const card = buildPlaceCard(feature, {
    sourceDate: '2026-10-17T20:20:51Z',
    buildingAddress: 'Njegoševa 12, Zgrada 4'
  });

  assert.equal(card.eyebrow, 'Eat & drink');
  assert.equal(card.title, 'Mimoza');
  assert.equal(card.subtitle, 'Café · Njegoševa 12');
  assert.equal(
    card.source,
    'Source: OpenStreetMap, snapshot 17 Oct 2026. Hours are as recorded, not checked.'
  );
  assert.deepEqual(
    card.sections.map(section => section.id),
    ['location-and-contacts', 'opening-hours']
  );
  const location = sectionById(card, 'location-and-contacts');
  assert.equal(rowByLabel(location, 'Address').value, 'Njegoševa 12');
  assert.equal(rowByLabel(location, 'In the building at').value, 'Njegoševa 12, Zgrada 4');
  assert.equal(rowByLabel(location, 'Coordinates').value, '42.43966° N, 19.26284° E');
  assert.equal(rowByLabel(location, 'Phone').value, '+382 20 123 456');
  assert.deepEqual(location.links, [
    {text: 'Website ↗', url: 'https://mimoza.example/'},
    {text: 'View source ↗', url: 'https://www.openstreetmap.org/node/308967902'}
  ]);
  assert.deepEqual(sectionById(card, 'opening-hours').rows, [
    {label: 'Monday – Friday', value: '07:00–23:00'}
  ]);
});

test('a POI card omits sections whose facts are absent', () => {
  const card = buildPlaceCard({
    geometry: {type: 'Point', coordinates: [19.26, 42.44]},
    properties: {name: 'Unlabelled place', kind: 'bench', source: 'OpenStreetMap'}
  });
  assert.equal(card.subtitle, 'Bench');
  assert.deepEqual(
    card.sections.map(section => section.id),
    ['location-and-contacts']
  );
  assert.deepEqual(sectionById(card, 'location-and-contacts').rows, [
    {label: 'Coordinates', value: '42.44000° N, 19.26000° E'}
  ]);
  assert.equal(card.source, 'Source: OpenStreetMap.');
});

test('a building card groups addresses, entrances and places mapped inside the footprint', () => {
  const facts = {
    kind: 'Building',
    properties: {building: 'apartments', 'building:levels': 4, source: 'OpenStreetMap'},
    addressLine: 'Njegoševa 12',
    addresses: ['Njegoševa 12'],
    entrances: [
      {number: '27', ref: 'M', label: '27, Ulaz M', address: 'Njegoševa 12, Ulaz 27'},
      {number: '29', label: '29', address: 'Njegoševa 12, Ulaz 29'}
    ],
    typeLabel: 'Building',
    source: 'OpenStreetMap',
    sourceDate: '2026-10-17T20:20:51Z'
  };
  const placesInside = [
    {
      properties: {name: 'Mimoza', kind: 'cafe', opening_hours: 'Mo-Fr 07:00-23:00'}
    }
  ];
  const card = buildObjectCard(
    {
      coordinates: [19.262, 42.44],
      name: 'Unnamed building',
      kind: 'Building',
      facts
    },
    {placesInside, sourceDate: '2026-10-17T20:20:51Z'}
  );

  assert.equal(card.eyebrow, 'Building');
  assert.equal(card.title, 'Unnamed building');
  assert.equal(card.subtitle, 'Apartments · 4 levels · 1 recorded address');
  assert.deepEqual(
    card.sections.map(section => section.id),
    ['addresses', 'entrances', 'inside-this-building', 'details']
  );
  assert.deepEqual(sectionById(card, 'addresses').rows[0], {label: '', value: 'Njegoševa 12'});
  assert.deepEqual(sectionById(card, 'entrances').rows, [
    {label: '', value: '1 · 27, Ulaz M · Njegoševa 12, Ulaz 27'},
    {label: '', value: '2 · 29 · Njegoševa 12, Ulaz 29'}
  ]);
  assert.deepEqual(sectionById(card, 'inside-this-building').rows, [
    {label: '', value: 'Mimoza · Café · 07:00–23:00'}
  ]);
  assert.equal(rowByLabel(sectionById(card, 'details'), 'Coordinates').value, '42.44000° N, 19.26200° E');
  assert.equal(card.source, 'Source: OpenStreetMap, snapshot 17 Oct 2026.');
});

test('other map objects use the same card without duplicating their source line', () => {
  const stop = describePoint(
    {
      layer: {id: 'transport-stops'},
      geometry: {type: 'Point', coordinates: [19.254951, 42.446057]},
      properties: {name: 'Ul. 13. jula (B)', stopId: '1'}
    },
    [19, 42]
  );
  const card = buildObjectCard(stop);
  const details = sectionById(card, 'details');

  assert.equal(card.eyebrow, 'Bus stop');
  assert.equal(card.title, 'Ul. 13. jula (B)');
  assert.equal(details.rows.filter(row => row.label === 'Stop ID').length, 1);
  assert.equal(details.rows.filter(row => row.label === 'Source').length, 0);
  assert.equal(rowByLabel(details, 'Coordinates').value, '42.44606° N, 19.25495° E');
  assert.equal(card.source, 'Source: ePodgorica, snapshot 18 Oct 2026.');
});

test('footprint membership respects holes, separate parts and invalid points', () => {
  const footprint = {
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
          [0, 0]
        ],
        [
          [1, 1],
          [3, 1],
          [3, 3],
          [1, 3],
          [1, 1]
        ]
      ]
    }
  };
  const place = coordinates => ({geometry: {type: 'Point', coordinates}});
  const candidates = [place([0.5, 0.5]), place([2, 2]), place([5, 5]), place([2])];

  assert.deepEqual(placesInsideFootprint(footprint, candidates), [candidates[0]]);
  const multipart = {
    geometry: {
      type: 'MultiPolygon',
      coordinates: [footprint.geometry.coordinates, [[[10, 10], [12, 10], [12, 12], [10, 10]]]]
    }
  };
  assert.deepEqual(placesInsideFootprint(multipart, [...candidates, place([11, 11])]), [
    candidates[0],
    place([11, 11])
  ]);
  assert.deepEqual(placesInsideFootprint({geometry: {type: 'Point', coordinates: [1, 1]}}, candidates), []);
});
