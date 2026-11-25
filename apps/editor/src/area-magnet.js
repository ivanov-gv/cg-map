// Areas of one kind that are put side by side share their corners and sides. A point close to a neighbour goes to it.
import {roundedCoordinate, translateGeometry} from './geometry-editing.js';
import {coordinateAtOffset, distanceMetres, nearestPointOnOutline} from './geometry-measures.js';
import {featureCapabilities} from './layer-rules.js';
import {boundsOf, createKeptBox, entriesWithin} from './road-graph.js';

const magnetReachPixels = 12;

export const isArea = geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type);
export const polygonsOf = ({type, coordinates}) => (type === 'Polygon' ? [coordinates] : coordinates);

// Rings are read for every frame of a drag. Geometries are replaced, not changed in place, so their rings can be kept.
const ringsByGeometry = new WeakMap();

export function ringsOf(geometry) {
  if (!ringsByGeometry.has(geometry)) ringsByGeometry.set(geometry, polygonsOf(geometry).flat());
  return ringsByGeometry.get(geometry);
}

// A ring needs three corners and a closing one. One emptied or half-drawn part of a MultiPolygon makes the whole shape
// unusable: there is nothing to pull and no ground to compare with a neighbour.
const hasCorners = geometry => {
  const polygons = polygonsOf(geometry);
  return polygons.length > 0 && polygons.every(polygon => polygon.length > 0 && polygon.every(ring => ring.length >= 4));
};
export const hasOutline = geometry => isArea(geometry) && hasCorners(geometry);

// How far a finger reaches on the ground at this zoom.
export function reachMetres(coordinate, map) {
  const {x, y} = map.project(coordinate);
  const {lng, lat} = map.unproject([x + magnetReachPixels, y]);
  return distanceMetres(coordinate, [lng, lat]);
}

function offsetFrom([east, north], origin) {
  const coordinate = coordinateAtOffset([east, north], origin);
  return [coordinate[0] - origin[0], coordinate[1] - origin[1]];
}

function widenedBounds([west, south, east, north], metres) {
  const origin = [(west + east) / 2, (south + north) / 2];
  const [left, bottom] = offsetFrom([-metres, -metres], origin);
  const [right, top] = offsetFrom([metres, metres], origin);
  return [west + left, south + bottom, east + right, north + top];
}

const keptAreaLists = createKeptBox();

const canReshape = (entry, rule) =>
  isArea(entry.feature.geometry) && featureCapabilities(entry.feature, rule).canReshape;

// The other areas of the same file around a place or a shape. What only frames the map, such as the sea, is none of them.
// A wide box is kept per rule, so nearby questions of a drag need one read of the file.
export function neighbouringAreas(geometry, {filename, key}, context, marginMetres = 0) {
  const rule = context.rules.layers[filename];
  const bounds = widenedBounds(boundsOf({geometry}), marginMetres);
  const entries = context.entriesOf(filename);
  const candidates = keptAreaLists(
    entries,
    bounds,
    wideBounds => entriesWithin(entries, wideBounds).filter(entry => canReshape(entry, rule)),
    rule
  );
  return entriesWithin(candidates, bounds).filter(entry => entry.key !== key);
}

const pointGeometry = coordinate => ({type: 'LineString', coordinates: [coordinate, coordinate]});

// The areas that a point can go to.
export const areasAround = (coordinate, own, context, marginMetres) =>
  neighbouringAreas(pointGeometry(coordinate), own, context, marginMetres);

function nearestOf(candidates) {
  return candidates.reduce((nearest, candidate) => (candidate.distance < nearest.distance ? candidate : nearest), {
    distance: Infinity
  });
}

const isSameCoordinate = ([east, north], [otherEast, otherNorth]) => east === otherEast && north === otherNorth;

// A point already in the shape must not be pulled together with the one being placed, or the shape collapses.
const notUsed = (points, usedPoints) => points.filter(point => !usedPoints.some(used => isSameCoordinate(point, used)));

const cornersOf = entries =>
  entries
    .filter(({feature}) => hasOutline(feature.geometry))
    .flatMap(({feature}) => ringsOf(feature.geometry).flatMap(ring => ring.slice(0, -1)));

function nearestCorner(coordinate, corners) {
  return nearestOf(corners.map(corner => ({target: corner, distance: distanceMetres(corner, coordinate)})));
}

function nearestSide(coordinate, entries, usedPoints) {
  const targets = entries
    .filter(({feature}) => hasOutline(feature.geometry))
    .map(({feature}) => nearestPointOnOutline(coordinate, ringsOf(feature.geometry)).coordinate)
    .map(roundedCoordinate)
    .filter(target => !usedPoints.some(used => isSameCoordinate(target, used)));
  return nearestOf(targets.map(target => ({target, distance: distanceMetres(coordinate, target)})));
}

// Where a point goes: to the nearest corner within reach, otherwise onto the nearest side, or null.
export function magneticPoint(coordinate, entries, reach, usedPoints = []) {
  if (!(reach > 0)) return null;
  const corner = nearestCorner(coordinate, notUsed(cornersOf(entries), usedPoints));
  if (corner.distance <= reach) return corner.target;
  const side = nearestSide(coordinate, entries, usedPoints);
  return side.distance <= reach ? side.target : null;
}

// A cell is at least as wide as the reach in both directions, so a nearby corner is in one of the nine cells around a
// point. Only those cells are read, which keeps a long outline quick to move.
const cellKey = (column, row) => `${column},${row}`;

function reachInDegrees(coordinate, reach) {
  const [east, north] = coordinateAtOffset([reach, reach], coordinate);
  return Math.max(Math.abs(east - coordinate[0]), Math.abs(north - coordinate[1]));
}

function cellsOf(corners, sizeDegrees) {
  const cells = new Map();
  for (const corner of corners) {
    const key = cellKey(Math.floor(corner[0] / sizeDegrees), Math.floor(corner[1] / sizeDegrees));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(corner);
  }
  return cells;
}

const adjacentOffsets = [-1, 0, 1];

function nearestCornerInCells(corner, cells, sizeDegrees) {
  const column = Math.floor(corner[0] / sizeDegrees);
  const row = Math.floor(corner[1] / sizeDegrees);
  const nearby = adjacentOffsets.flatMap(offsetColumn =>
    adjacentOffsets.flatMap(offsetRow => cells.get(cellKey(column + offsetColumn, row + offsetRow)) ?? [])
  );
  return nearestOf(nearby.map(candidate => ({corner: candidate, distance: distanceMetres(candidate, corner)})));
}

// A whole area goes to its neighbours with the corner that is closest to one of theirs, otherwise to a side.
export function magneticallyMoved(geometry, entries, reach) {
  if (!hasOutline(geometry) || !(reach > 0)) return geometry;
  const own = ringsOf(geometry).flatMap(ring => ring.slice(0, -1));
  const neighbours = cornersOf(entries);
  if (own.length === 0 || neighbours.length === 0) return geometry;
  const sizeDegrees = reachInDegrees(own[0], reach);
  if (!(sizeDegrees > 0)) return geometry;
  const ownCells = cellsOf(own, sizeDegrees);
  const closest = neighbours.reduce((nearest, target) => {
    const candidate = nearestCornerInCells(target, ownCells, sizeDegrees);
    return candidate.distance < nearest.distance
      ? {corner: candidate.corner, target, distance: candidate.distance}
      : nearest;
  }, {distance: Infinity});
  if (closest.distance <= reach) {
    const {corner, target} = closest;
    return translateGeometry(geometry, target[0] - corner[0], target[1] - corner[1]);
  }
  const toSide = nearestOf(own.map(corner => ({corner, ...nearestSide(corner, entries, [])})));
  if (toSide.distance > reach) return geometry;
  const {corner, target} = toSide;
  return translateGeometry(geometry, target[0] - corner[0], target[1] - corner[1]);
}
