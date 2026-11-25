// Areas of one kind that are put side by side share their corners and sides. A point close to a neighbour goes to it.
import {roundedCoordinate, translateGeometry} from './geometry-editing.js';
import {distanceMetres, nearestPointOnOutline} from './geometry-measures.js';
import {featureCapabilities} from './layer-rules.js';
import {boundsOf} from './road-graph.js';

const magnetReachPixels = 12;

export const isArea = geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type);
export const polygonsOf = ({type, coordinates}) => (type === 'Polygon' ? [coordinates] : coordinates);

// Rings are read for every frame of a drag. Geometries are replaced, not changed in place, so their rings can be kept.
const ringsByGeometry = new WeakMap();

export function ringsOf(geometry) {
  if (!ringsByGeometry.has(geometry)) ringsByGeometry.set(geometry, polygonsOf(geometry).flat());
  return ringsByGeometry.get(geometry);
}

// An emptied ring is still an area by type, but has no corner to pull and no ground to overlap.
const hasCorners = geometry => ringsOf(geometry).some(ring => ring.length > 0);
export const hasOutline = geometry => isArea(geometry) && hasCorners(geometry);

// How far a finger reaches on the ground at this zoom.
export function reachMetres(coordinate, map) {
  const {x, y} = map.project(coordinate);
  const {lng, lat} = map.unproject([x + magnetReachPixels, y]);
  return distanceMetres(coordinate, [lng, lat]);
}

const metresPerDegreeOfLatitude = 111200;

function widenedBounds([west, south, east, north], metres) {
  const latitudeMargin = metres / metresPerDegreeOfLatitude;
  const longitudeMargin = latitudeMargin / Math.cos((south * Math.PI) / 180);
  return [west - longitudeMargin, south - latitudeMargin, east + longitudeMargin, north + latitudeMargin];
}

// A finger reaches a few cells. Very long outlines are kept aside, because filing each of their cells would cost more
// than checking them on every frame; a query wider than the cap reads all entries instead.
const indexCellDegrees = 0.001;
const maxCellsPerEntry = 64;
const maxQueryCells = 1024;

const cellKey = (column, row) => `${column},${row}`;
const boundsAreFinite = ([west, south, east, north]) =>
  [west, south, east, north].every(Number.isFinite);

function cellRange([west, south, east, north]) {
  return {
    firstColumn: Math.floor(west / indexCellDegrees),
    lastColumn: Math.floor(east / indexCellDegrees),
    firstRow: Math.floor(south / indexCellDegrees),
    lastRow: Math.floor(north / indexCellDegrees)
  };
}

const cellCountOf = ({firstColumn, lastColumn, firstRow, lastRow}) =>
  (lastColumn - firstColumn + 1) * (lastRow - firstRow + 1);

const overlapsBounds = ([left, bottom, right, top], [west, south, east, north]) =>
  left <= east && right >= west && bottom <= north && top >= south;

function buildAreaIndex(entries) {
  const cells = new Map();
  const wideIndices = [];
  const bounds = entries.map(({feature}) => boundsOf(feature));

  entries.forEach((_entry, index) => {
    if (!boundsAreFinite(bounds[index])) {
      wideIndices.push(index);
      return;
    }
    const range = cellRange(bounds[index]);
    if (cellCountOf(range) > maxCellsPerEntry) {
      wideIndices.push(index);
      return;
    }
    for (let column = range.firstColumn; column <= range.lastColumn; column += 1) {
      for (let row = range.firstRow; row <= range.lastRow; row += 1) {
        const key = cellKey(column, row);
        if (cells.has(key)) cells.get(key).push(index);
        else cells.set(key, [index]);
      }
    }
  });

  return {entries, bounds, cells, wideIndices, allIndices: entries.map((_entry, index) => index)};
}

// Capabilities and boxes are costly, and entries are replaced as a whole when a file changes, so the array's identity
// tells us when to ask again.
const areaIndexByEntries = new WeakMap();

function areaIndex(entries, filename, rule) {
  let byRule = areaIndexByEntries.get(entries);
  if (!byRule) {
    byRule = new WeakMap();
    areaIndexByEntries.set(entries, byRule);
  }
  let byFilename = byRule.get(rule);
  if (!byFilename) {
    byFilename = new Map();
    byRule.set(rule, byFilename);
  }
  if (!byFilename.has(filename)) {
    const reshapeable = entries.filter(
      entry => isArea(entry.feature.geometry) && featureCapabilities(entry.feature, rule).canReshape
    );
    byFilename.set(filename, buildAreaIndex(reshapeable));
  }
  return byFilename.get(filename);
}

// Candidates come back in source order, so the same shape always gives the same neighbours.
function entriesInBounds(index, bounds) {
  if (!boundsAreFinite(bounds)) return [];
  const range = cellRange(bounds);
  const positions =
    cellCountOf(range) > maxQueryCells
      ? index.allIndices
      : [...indicesOfCells(index, range)].sort((first, second) => first - second);
  return positions
    .filter(position => overlapsBounds(index.bounds[position], bounds))
    .map(position => index.entries[position]);
}

function indicesOfCells(index, {firstColumn, lastColumn, firstRow, lastRow}) {
  const positions = new Set(index.wideIndices);
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (const position of index.cells.get(cellKey(column, row)) ?? []) positions.add(position);
    }
  }
  return positions;
}

// The other areas of the same file around a place or a shape. What only frames the map, such as the sea, is none of them.
export function neighbouringAreas(geometry, {filename, key}, context, marginMetres = 0) {
  const rule = context.rules.layers[filename];
  const bounds = widenedBounds(boundsOf({geometry}), marginMetres);
  const entries = entriesInBounds(areaIndex(context.entriesOf(filename), filename, rule), bounds);
  return entries.filter(entry => entry.key !== key);
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

const cornersOf = entries => entries.flatMap(({feature}) => ringsOf(feature.geometry).flatMap(ring => ring.slice(0, -1)));

function nearestCorner(coordinate, corners) {
  return nearestOf(corners.map(corner => ({target: corner, distance: distanceMetres(corner, coordinate)})));
}

function nearestSide(coordinate, entries, usedPoints) {
  const outlines = entries
    .map(({feature}) => nearestPointOnOutline(coordinate, ringsOf(feature.geometry)))
    .filter(({coordinate: target}) => !usedPoints.some(used => isSameCoordinate(target, used)));
  return nearestOf(outlines.map(({coordinate: target, distanceMetres: distance}) => ({target, distance})));
}

// Where a point goes: to the nearest corner within reach, otherwise onto the nearest side, or null.
export function magneticPoint(coordinate, entries, reach, usedPoints = []) {
  const corner = nearestCorner(coordinate, notUsed(cornersOf(entries), usedPoints));
  if (corner.distance <= reach) return corner.target;
  const side = nearestSide(coordinate, entries, usedPoints);
  return side.distance <= reach ? roundedCoordinate(side.target) : null;
}

// A whole area goes to its neighbours with the corner that is closest to one of theirs, otherwise to a side.
export function magneticallyMoved(geometry, entries, reach) {
  if (!hasOutline(geometry)) return geometry;
  const own = ringsOf(geometry).flatMap(ring => ring.slice(0, -1));
  const corners = cornersOf(entries);
  const toCorner = nearestOf(own.map(corner => ({corner, ...nearestCorner(corner, corners)})));
  const toSide = () => nearestOf(own.map(corner => ({corner, ...nearestSide(corner, entries, [])})));
  const closest = toCorner.distance <= reach ? toCorner : toSide();
  if (closest.distance > reach) return geometry;
  const {corner, target} = closest;
  return translateGeometry(geometry, target[0] - corner[0], target[1] - corner[1]);
}
