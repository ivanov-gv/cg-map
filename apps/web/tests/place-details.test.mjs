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
  const nearbyPlaces = [
    {
      feature: {properties: {id: 'node/2', name: 'Bakery', category: 'food', kind: 'bakery'}},
      distanceKilometres: 0.12
    },
    {
      feature: {properties: {id: 'node/3', name: 'Bookshop', category: 'shops', kind: 'books'}},
      distanceKilometres: 0.26
    },
    {
      feature: {properties: {id: 'node/4', name: 'Far café', category: 'food', kind: 'cafe'}},
      distanceKilometres: 0.61
    }
  ];
  const card = buildPlaceCard(feature, {
    sourceDate: '2026-10-17T20:20:51Z',
    buildingAddress: 'Njegoševa 12, Zgrada 4',
    nearbyPlaces
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
    ['location-and-contacts', 'opening-hours', 'nearby']
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
  assert.deepEqual(
    sectionById(card, 'nearby').rows.map(row => row.value),
    ['Bakery · Eat & drink · 120 m', 'Bookshop · Shops · 260 m']
  );
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
  assert.equal(rowByLabel(sectionById(card, 'location-and-contacts'), 'Coordinates').value, '42.44000° N, 19.26000° E');
  assert.equal(card.source, 'Source: OpenStreetMap.');
});

test('a building card groups addresses, entrances and places mapped inside the footprint', () => {
  const facts = {
    kind: 'Building',
    properties: {building: 'apartments', 'building:levels': 4, name: 'A different label', source: 'OpenStreetMap'},
    addressLine: 'Njegoševa 12, 14',
    addresses: ['Njegoševa 12', 'Njegoševa 14'],
    entrances: [
      {number: '27', ref: 'M', label: '27, Ulaz M', address: 'Njegoševa 12, Ulaz 27'},
      {number: '29', label: '29', address: 'Njegoševa 14, Ulaz 29'}
    ],
    typeLabel: 'Building',
    source: 'OpenStreetMap',
    sourceDate: '2026-10-17T20:20:51Z'
  };
  const placesInside = [
    {
      properties: {
        name: 'Mimoza',
        kind: 'cafe',
        opening_hours: 'Mo-Fr 08:00-18:00; Sa 10:00-14:00'
      }
    },
    {
      properties: {name: 'Late shop', kind: 'shop', opening_hours: 'Mo-Fr 09:00-17:00; Su'}
    }
  ];
  const card = buildObjectCard(
    {
      coordinates: [19.262, 42.44],
      name: 'Building 12, 14',
      kind: 'Building',
      facts
    },
    {placesInside, sourceDate: '2026-10-17T20:20:51Z'}
  );

  assert.equal(card.eyebrow, 'Building');
  assert.equal(card.title, 'Building 12, 14');
  assert.equal(card.subtitle, 'Apartments · 4 levels · 2 recorded addresses');
  assert.deepEqual(
    card.sections.map(section => section.id),
    ['addresses', 'entrances', 'inside-this-building', 'details']
  );
  assert.deepEqual(sectionById(card, 'addresses').rows, [
    {label: '', value: 'Njegoševa 12'},
    {label: '', value: 'Njegoševa 14'}
  ]);
  assert.deepEqual(sectionById(card, 'entrances').rows, [
    {label: '', value: '27, Ulaz M · Njegoševa 12, Ulaz 27'},
    {label: '', value: '29 · Njegoševa 14, Ulaz 29'}
  ]);
  assert.deepEqual(sectionById(card, 'inside-this-building').rows, [
    {label: '', value: 'Mimoza · Café · Monday – Friday 08:00–18:00, Saturday 10:00–14:00'},
    {label: '', value: 'Late shop · Shop · Mo-Fr 09:00-17:00; Su'}
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

test('object detail rows come from facts rather than display strings', () => {
  const card = buildObjectCard({
    name: 'Bridge',
    kind: 'Bridge',
    coordinates: [19.262, 42.44],
    details: ['Type: Wrong', 'Invented: value', 'Source: OpenStreetMap'],
    facts: {
      kind: 'Bridge',
      typeLabel: 'Bridge',
      detailRows: [{label: 'Road', value: 'M-2'}],
      properties: {},
      addressLine: '',
      addresses: [],
      entrances: [],
      source: ''
    }
  });

  assert.deepEqual(
    sectionById(card, 'details').rows.map(row => row.label),
    ['Road', 'Type', 'Coordinates']
  );
  assert.equal(rowByLabel(sectionById(card, 'details'), 'Road').value, 'M-2');
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

test('separate rendered footprint fragments form one building footprint', () => {
  const fragments = [
    {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0]
          ]
        ]
      }
    },
    {
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [10, 10],
            [12, 10],
            [12, 12],
            [10, 12],
            [10, 10]
          ]
        ]
      }
    }
  ];
  const first = {geometry: {type: 'Point', coordinates: [1, 1]}};
  const second = {geometry: {type: 'Point', coordinates: [11, 11]}};
  const outside = {geometry: {type: 'Point', coordinates: [5, 5]}};

  assert.deepEqual(placesInsideFootprint(fragments, [first, second, outside]), [first, second]);
});
