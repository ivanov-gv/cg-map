// A city of a few objects per layer, small enough to read, with everything the current bundle version holds. Layers that
// the pinned reviewed data does not have yet are tested on it. The rules beside it are this app's own copy for tests: the
// pinned contracts package gets them with its next release, and tests/ checks the real files at HEAD until then.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {bundleFilesByVersion, currentBundleVersion} from '../../src/source-bundle.js';

const rules = JSON.parse(readFileSync(new URL('../fixtures/editor-layers.json', import.meta.url)));
export const cityCentre = [19.26, 42.44];
// About 11 m north and 8 m east: close enough that a whole block fits the smallest test window at zoom 18.
const step = 0.0001;

// A coordinate this many steps east and north of the centre.
export const at = (east, north) => [cityCentre[0] + east * step, cityCentre[1] + north * step];

// The steps that a coordinate lies east and north of the centre, rounded for comparing.
export const stepsOf = ([longitude, latitude]) =>
  [(longitude - cityCentre[0]) / step, (latitude - cityCentre[1]) / step].map(value => Math.round(value * 10) / 10);

const points = (...corners) => corners.map(([east, north]) => at(east, north));
const line = (...corners) => ({type: 'LineString', coordinates: points(...corners)});
const ring = corners => [...points(...corners), at(...corners[0])];
const polygon = (...rings) => ({type: 'Polygon', coordinates: rings.map(ring)});
const point = (east, north) => ({type: 'Point', coordinates: at(east, north)});
const square = (west, south, size) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size]
];
const hash = `sha256:${'a'.repeat(64)}`;

function feature(entityId, properties, geometry, fields = {}) {
  const entityVersion = /^(node|way|relation)\//.test(entityId) ? 1 : hash;
  return {type: 'Feature', ...fields, properties: {entityId, entityVersion, ...properties}, geometry};
}

const building = (number, corners, properties = {}) =>
  feature(`way/${number}`, {kind: 'building', building: 'yes', osm_id: `way/${number}`, ...properties}, polygon(corners));
const road = (number, name, geometry, properties = {}) =>
  feature(`way/${number}`, {kind: 'residential', name, ...properties}, geometry);
const contour = (number, elevation, corners) =>
  feature(
    `derived:contour-${number}`,
    {kind: 'contour', elevation, index: elevation % 100 === 0},
    {type: 'LineString', coordinates: ring(corners)}
  );
const stop = (id, name, lines, geometry) =>
  feature(`epodgorica:${id}`, {name, stopId: id, lines, side: 'left'}, geometry, {id});

function cityFeatures() {
  return {
    'buildings.geojson': [
      building(1, square(-3, 1, 2), {'addr:street': 'Main street', 'addr:housenumber': '14', 'building:levels': '5'}),
      building(2, square(1, 1, 2)),
      building(3, square(-3, -3, 2))
    ],
    'building-labels.geojson': [
      feature(
        'way/1',
        {
          kind: 'building',
          osm_id: 'way/1',
          footprintIndex: 0,
          'addr:street': 'Main street',
          'addr:housenumber': '14',
          address_sources: ['way/1']
        },
        point(-2, 2),
        {id: 'way/1'}
      )
    ],
    'building-entrances.geojson': [
      feature('node/10', {kind: 'entrance', entrance: 'main', ref: '1', buildingEntityId: 'way/1'}, point(-2, 1))
    ],
    'places.geojson': [
      feature(
        'node/20',
        {
          id: 'node/20',
          source: 'OpenStreetMap',
          name: 'Corner cafe',
          category: 'food',
          kind: 'cafe',
          visibilityLevel: 3,
          buildingEntityId: 'way/1'
        },
        point(-2.5, 2.5)
      )
    ],
    'roads.geojson': [
      road(30, 'Main street', line([-6, 0], [0, 0], [6, 0])),
      road(31, 'Side street', line([6, 0], [6, 5])),
      road(32, 'Far street', line([-6, -6], [6, -6]))
    ],
    'road-nodes.geojson': [feature('node/40', {kind: 'crossing'}, point(0, 0))],
    'land.geojson': [
      feature('relation/1', {kind: 'country', name: 'Country'}, polygon(square(-600, -600, 1200))),
      feature('way/50', {kind: 'park', name: 'Town park', osmTag: 'leisure=park'}, polygon(square(2, -5, 4)))
    ],
    'protected-areas.geojson': [
      feature(
        'way/51',
        {kind: 'protected-area', name: 'Old forest', osmTag: 'leisure=nature_reserve'},
        polygon(square(8, -5, 2))
      )
    ],
    'water.geojson': [
      feature('derived:ocean', {kind: 'ocean'}, {
        type: 'MultiPolygon',
        coordinates: [[ring([[-900, -900], [-600, -900], [-600, -600], [-600, 600], [-900, 600]])]]
      }),
      feature('way/60', {kind: 'lake', name: 'Town lake', osmTag: 'natural=water'}, polygon(square(-9, 2, 3))),
      feature('way/61', {kind: 'stream', name: 'Creek', osmTag: 'waterway=stream'}, line([-9, 8], [-7.5, 5])),
      feature('way/62', {kind: 'coastline', osmTag: 'natural=coastline'}, line([-600, -600], [-600, 0], [-600, 600]))
    ],
    'contours.geojson': [
      contour(40, 40, square(10, 0, 10)),
      contour(60, 60, square(12, 2, 6)),
      contour(80, 80, square(14, 4, 2))
    ],
    'summits.geojson': [
      feature(
        'node/70',
        {
          kind: 'summit',
          natural: 'peak',
          name: 'Town hill',
          ele: 92,
          demElevation: 91,
          surroundingDemElevation: 60,
          enclosingContourElevation: 80,
          heightCheck: 'ok',
          mismatch: false,
          mismatchReasons: []
        },
        point(15, 5),
        {id: 'node/70'}
      )
    ],
    'slopes.geojson': [
      feature(
        'derived:slope-sunlit',
        {kind: 'slope', aspect: 'sunlit', areaSquareMetres: 100},
        polygon([[10, 0], [20, 0], [20, 5], [15, 5], [10, 5]])
      ),
      feature(
        'derived:slope-shaded',
        {kind: 'slope', aspect: 'shaded', areaSquareMetres: 100},
        polygon([[10, 5], [15, 5], [20, 5], [20, 10], [10, 10]])
      )
    ],
    'ridges.geojson': [
      feature(
        'derived:ridge-1',
        {kind: 'ridge', sunlitSide: 'south', shadedSide: 'north', summit: 'node/70', summitName: 'Town hill'},
        line([10, 5], [15, 5], [20, 5])
      )
    ],
    'canyon-rims.geojson': [
      feature(
        'derived:rim-1',
        {kind: 'canyon-rim', river: 'Ribnica', bank: 'left', method: 'dem-canyon-bank', lengthMetres: 20},
        line([-9, 9], [-7, 9])
      )
    ],
    'settlements.geojson': [
      feature(
        'node/80',
        {
          kind: 'settlement',
          name: 'Town',
          rank: 'town',
          place: 'town',
          municipality: 'ME-01',
          source: 'OpenStreetMap'
        },
        point(0, 8)
      )
    ],
    'settlement-areas.geojson': [
      feature(
        'way/81',
        {kind: 'settlement-area', name: 'Town', settlementEntityId: 'node/80'},
        polygon(square(-5, 6, 4))
      )
    ],
    'border-edges.geojson': [
      feature(
        'derived:edge-1',
        {kind: 'border', left: 'ME-01', right: 'ME-02', osmWays: []},
        line([0, -600], [0, 0], [0, 600])
      ),
      feature(
        'derived:edge-2',
        {kind: 'border', left: 'sea', right: 'ME-01', osmWays: []},
        line([0, -600], [-600, -600], [-600, 600], [0, 600])
      ),
      feature(
        'derived:edge-3',
        {kind: 'border', left: 'ME-02', right: 'Neighbour', osmWays: []},
        line([0, -600], [600, -600], [600, 600], [0, 600])
      )
    ],
    'municipalities.geojson': [
      feature(
        'relation/90',
        {
          kind: 'municipality',
          'ISO3166-2': 'ME-01',
          name: 'West',
          labelPoint: at(-300, 0),
          edges: [
            {id: 'derived:edge-1', direction: 1},
            {id: 'derived:edge-2', direction: -1}
          ]
        },
        polygon([[0, -600], [0, 0], [0, 600], [-600, 600], [-600, -600]])
      ),
      feature(
        'relation/91',
        {
          kind: 'municipality',
          'ISO3166-2': 'ME-02',
          name: 'East',
          labelPoint: at(300, 0),
          edges: [
            {id: 'derived:edge-3', direction: 1},
            {id: 'derived:edge-1', direction: -1}
          ]
        },
        polygon([[0, -600], [600, -600], [600, 600], [0, 600], [0, 0]])
      )
    ],
    'context-countries.geojson': [
      feature('ne:NBR', {kind: 'country', name: 'Neighbour'}, polygon(square(600, -600, 1200)))
    ],
    'transport-stops.geojson': [
      stop('1', 'West stop', ['6'], point(-5, 0.2)),
      stop('2', 'Middle stop', ['6'], point(0, 0.2)),
      stop('3', 'East stop', [], point(5, 0.2))
    ]
  };
}

const transitRoutes = {
  retrievedAt: '2026-10-18T19:54:19Z',
  source: 'fixture',
  version: 1,
  routes: [
    {
      number: '6',
      name: 'West - Middle',
      network: 'bus',
      colour: '#1b75bb',
      directions: [
        {headsign: 'Middle', stops: ['1', '2']},
        {headsign: 'West', stops: ['2', '1']}
      ]
    }
  ]
};
const turnRestrictions = {entitySchemaVersion: 1, restrictions: []};

function sourceText(filename, features) {
  if (filename === 'transit-routes.json') return JSON.stringify(transitRoutes);
  if (filename === 'turn-restrictions.json') return JSON.stringify(turnRestrictions);
  return JSON.stringify({type: 'FeatureCollection', entitySchemaVersion: 1, features: features[filename]});
}

const featureCountOf = (filename, features) =>
  ({'transit-routes.json': transitRoutes.routes.length, 'turn-restrictions.json': 0})[filename] ??
  features[filename].length;

// Every source file of the city as text, with the manifest the editor verifies it by.
export function fixtureBundle() {
  const features = cityFeatures();
  const filenames = bundleFilesByVersion[currentBundleVersion];
  const files = new Map(filenames.map(filename => [filename, sourceText(filename, features)]));
  const layers = filenames.map(filename => ({
    filename,
    sha256: createHash('sha256').update(files.get(filename)).digest('hex'),
    bytes: Buffer.byteLength(files.get(filename)),
    featureCount: featureCountOf(filename, features)
  }));
  return {files, manifest: {version: currentBundleVersion, layers}};
}

// Opens the editor on the fixture city and waits for Browse.
export async function openFixtureCity(page) {
  const {files, manifest} = fixtureBundle();
  await page.route('**/sources/*', route => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    const body = filename === 'manifest.json' ? JSON.stringify(manifest) : files.get(filename);
    return route.fulfill({body, contentType: 'application/json'});
  });
  await page.route('**/data/editor-layers.json', route => route.fulfill({json: rules}));
  await page.goto('./');
  await page.locator('#status').filter({hasText: 'Browse'}).waitFor({state: 'attached'});
}
