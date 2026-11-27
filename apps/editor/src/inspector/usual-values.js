// How every free field of a form is filled in: what it usually says is offered as a list, and only what differs from one
// object to the next is typed. A property of the rules that is in neither of these lists fails the tests.
import {boundsAroundMetres, entriesWithin} from '../layers/roads/road-graph.js';

const roadsFile = 'roads.geojson';
const nearbyMetres = 400;
const highestFloor = 30;
const lowestFloor = -4;
const firstYear = 1850;

const numbersFrom = (first, last) => Array.from({length: last - first + 1}, (_unused, index) => String(first + index));

// Values in the order of how often they are used.
export function byFrequency(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((first, second) => second[1] - first[1]).map(([value]) => value);
}

const isStated = value => value !== undefined && value !== '';

// What the other objects of a file say.
const usedIn = (filename, name) => (_feature, context) =>
  byFrequency(context.entriesOf(filename).map(({feature}) => feature.properties[name]).filter(isStated));

// The names of the streets around, because a street is usually drawn in parts.
function streetNamesNearby({geometry}, context) {
  const coordinate = geometry?.coordinates?.[0];
  if (!coordinate) return [];
  const roads = entriesWithin(context.entriesOf(roadsFile), boundsAroundMetres(coordinate, nearbyMetres));
  return byFrequency(roads.map(({feature}) => feature.properties.name).filter(isStated));
}

// Dark enough to be read on the map.
export const lineColours = {
  '#c8372d': 'Red',
  '#d35400': 'Orange',
  '#b7950b': 'Yellow',
  '#1e8449': 'Green',
  '#117a65': 'Teal',
  '#1b75bb': 'Blue',
  '#1a5276': 'Dark blue',
  '#7d3c98': 'Purple',
  '#ad1457': 'Pink',
  '#6e4b2a': 'Brown',
  '#424949': 'Grey'
};

const floors = () => numbersFrom(lowestFloor, highestFloor).toReversed();
const years = () => numbersFrom(firstYear, new Date().getFullYear()).toReversed();

// By file and property: what is offered beside "Other…".
const usualValues = {
  'places.geojson': {level: floors},
  'building-entrances.geojson': {level: floors},
  'buildings.geojson': {
    'building:levels': () => numbersFrom(1, highestFloor),
    'roof:levels': () => numbersFrom(0, 5),
    start_date: years
  },
  [roadsFile]: {name: streetNamesNearby, ref: usedIn(roadsFile, 'ref')},
  'transit-routes.json': {colour: () => Object.keys(lineColours)}
};

export function usualValuesOf(filename, feature, context) {
  const fields = Object.entries(usualValues[filename] ?? {});
  return Object.fromEntries(fields.map(([name, valuesOf]) => [name, valuesOf(feature, context)]));
}

// What is different for nearly every object, so that a list would only be in the way: names, contacts, numbers of houses
// and entrances, links to other works, and measured heights and widths. A name is typed unless its file lists usual
// values, which is why road numbers keep their list.
const typedNames = new Set([
  'name',
  'name:en',
  'name:sr-Latn',
  'addr:housenumber',
  'building_number',
  'phone',
  'website',
  'email',
  'wikidata',
  'wikipedia',
  'ele',
  'height',
  'width',
  'number',
  'ref'
]);

export const isTyped = (filename, name) => typedNames.has(name) && !usualValues[filename]?.[name];
export const hasUsualValues = (filename, name) => Boolean(usualValues[filename]?.[name]);
