// Timings for the magnet's hot paths on the reviewed sources. Reads data directly, as the dev build does.
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {magneticallyMoved, neighbouringAreas} from '../src/area-magnet.js';
import {jointAt} from '../src/road-graph.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const rules = {
  layers: JSON.parse(readFileSync(new URL('../tests/fixtures/editor-layers.json', import.meta.url), 'utf8')).layers
};

function entriesOf(filename) {
  const data = JSON.parse(readFileSync(`${root}data/sources/${filename}`, 'utf8'));
  return data.features.map((feature, index) => ({
    filename,
    key: String(index),
    feature: {type: 'Feature', properties: feature.properties, geometry: feature.geometry}
  }));
}

function time(label, rounds, ask) {
  const durations = [];
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    ask();
    durations.push(performance.now() - started);
  }
  const sorted = durations.toSorted((first, second) => first - second);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(
    `${label}: first ${durations[0].toFixed(3)} ms, median ${median.toFixed(3)} ms, last ${durations.at(-1).toFixed(3)} ms`
  );
  return median;
}

const waterEntries = entriesOf('water.geojson');
const lake = waterEntries.find(({feature}) => feature.properties.name?.startsWith('Skadarsko jezero'));
const lakeOwn = {filename: 'water.geojson', key: lake.key};
const waterContext = {rules, entriesOf: () => waterEntries};
const lakeReach = 0.00025;
const neighbours = neighbouringAreas(lake.feature.geometry, lakeOwn, waterContext, lakeReach);
console.log(`lake corners: ${lake.feature.geometry.coordinates.length}, neighbours: ${neighbours.length}`);

time('lake neighbouringAreas', 5, () => neighbouringAreas(lake.feature.geometry, lakeOwn, waterContext, lakeReach));
const lakeMedian = time('lake magneticallyMoved', 5, () => magneticallyMoved(lake.feature.geometry, neighbours, lakeReach));
if (lakeMedian > 20) throw new Error(`lake magneticallyMoved median ${lakeMedian.toFixed(3)} ms exceeds 20 ms`);

const buildings = entriesOf('buildings.geojson');
const buildingContext = {rules, entriesOf: () => buildings};
const buildingOwn = {filename: 'buildings.geojson', key: '-1'};
const query = {
  type: 'Polygon',
  coordinates: [[[19.25, 42.44], [19.2501, 42.44], [19.2501, 42.4401], [19.25, 42.44]]]
};
const askBuildings = () => neighbouringAreas(query, buildingOwn, buildingContext, lakeReach);
time('buildings first + 200 nearby queries, same entries', 201, askBuildings);
time('buildings first query after a change', 1, () =>
  neighbouringAreas(query, buildingOwn, {rules, entriesOf: () => [...buildings]}, lakeReach)
);

const roads = entriesOf('roads.geojson');
const roadCoordinate = roads[0].feature.geometry.coordinates[0];
time('roads first + 200 nearby queries, same entries', 201, () => jointAt(roadCoordinate, roads));
time('roads first query after a change', 1, () => jointAt(roadCoordinate, [...roads]));
