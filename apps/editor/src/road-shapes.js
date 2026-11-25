// Splitting, joining and connecting roads, as pure edits of their features.
import {insertVertex, roundedCoordinate} from './geometry-editing.js';
import {nearestPointOnLine} from './geometry-measures.js';

// Two ends closer than this, in degrees, are one junction: source coordinates have six decimals.
const samePointDegrees = 1.5e-6;
const startNames = ['startNode', 'startLevel'];
const endNames = ['endNode', 'endLevel'];

export const isSamePoint = (first, second) =>
  Math.abs(first[0] - second[0]) < samePointDegrees && Math.abs(first[1] - second[1]) < samePointDegrees;

export const endsOf = ({geometry}) => [geometry.coordinates[0], geometry.coordinates.at(-1)];

function without(properties, names) {
  return Object.fromEntries(Object.entries(properties).filter(([name]) => !names.includes(name)));
}

// The facts a new road may state: only what the rules list, so it claims no upstream identity.
function statedProperties(properties, propertyRules) {
  return Object.fromEntries(Object.entries(properties).filter(([name]) => Object.hasOwn(propertyRules, name)));
}

// Returns why a road cannot be split at this point, or null.
export function splitProblem({geometry}, vertexIndex) {
  const isInner = vertexIndex > 0 && vertexIndex < geometry.coordinates.length - 1;
  return isInner ? null : 'Pick a point between the ends of the road.';
}

// The road up to a point, which keeps its identity, and a new road from that point on. The new ends meet at a junction,
// {node, level}, or claim none.
export function splitRoad(road, vertexIndex, propertyRules, junction = null) {
  const {coordinates} = road.geometry;
  const endingThere = junction ? {endNode: junction.node, endLevel: junction.level} : {};
  const startingThere = junction ? {startNode: junction.node, startLevel: junction.level} : {};
  const first = {
    ...road,
    properties: {...without(road.properties, endNames), ...endingThere},
    geometry: {...road.geometry, coordinates: coordinates.slice(0, vertexIndex + 1)}
  };
  const secondProperties = statedProperties(without(road.properties, startNames), propertyRules);
  const named = secondProperties.name?.trim() ? secondProperties : without(secondProperties, ['name']);
  const second = {
    type: 'Feature',
    properties: {...named, ...startingThere},
    geometry: {...road.geometry, coordinates: coordinates.slice(vertexIndex)}
  };
  return [first, second];
}

const reversedNames = [
  ['startNode', 'endNode'],
  ['startLevel', 'endLevel']
];

function reversedRoad(road) {
  const properties = without(road.properties, reversedNames.flat());
  for (const [startName, endName] of reversedNames) {
    if (road.properties[endName] !== undefined) properties[startName] = road.properties[endName];
    if (road.properties[startName] !== undefined) properties[endName] = road.properties[startName];
  }
  return {...road, properties, geometry: {...road.geometry, coordinates: road.geometry.coordinates.toReversed()}};
}

// Two roads that meet end to end as one, with the facts of the first, or null when they do not meet. The second one
// turns around where it has to.
export function joinedRoad(first, second) {
  const [firstStart, firstEnd] = endsOf(first);
  const [secondStart, secondEnd] = endsOf(second);
  const orders = [
    {meets: isSamePoint(firstEnd, secondStart), head: first, tail: second},
    {meets: isSamePoint(firstEnd, secondEnd), head: first, tail: reversedRoad(second)},
    {meets: isSamePoint(firstStart, secondEnd), head: second, tail: first},
    {meets: isSamePoint(firstStart, secondStart), head: reversedRoad(second), tail: first}
  ];
  const order = orders.find(({meets}) => meets);
  if (!order) return null;
  const {head, tail} = order;
  const properties = without(first.properties, [...startNames, ...endNames]);
  for (const name of startNames) if (head.properties[name] !== undefined) properties[name] = head.properties[name];
  for (const name of endNames) if (tail.properties[name] !== undefined) properties[name] = tail.properties[name];
  const coordinates = [...head.geometry.coordinates, ...tail.geometry.coordinates.slice(1)];
  return {...first, properties, geometry: {...first.geometry, coordinates}};
}

// The road with a point where another one meets it, or null when it has one there or passes too far away. Roads that
// share a point are joined.
export function withJunctionAt(road, coordinate, toleranceMetres) {
  const {coordinates} = road.geometry;
  if (coordinates.some(point => isSamePoint(point, coordinate))) return null;
  const nearest = nearestPointOnLine(coordinate, coordinates);
  if (nearest.distanceMetres > toleranceMetres) return null;
  const geometry = insertVertex(road.geometry, {vertexIndex: nearest.segmentIndex});
  geometry.coordinates[nearest.segmentIndex + 1] = roundedCoordinate(coordinate);
  return {...road, geometry};
}
