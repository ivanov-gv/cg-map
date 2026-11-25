// Areas of one kind that are put side by side share their corners and sides. A point close to a neighbour goes to it.
import {roundedCoordinate, translateGeometry} from './geometry-editing.js';
import {distanceMetres, nearestPointOnOutline} from './geometry-measures.js';
import {featureCapabilities} from './layer-rules.js';
import {boundsOf, entriesWithin} from './road-graph.js';

const reachPixels = 12;

export const isArea = geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type);
export const polygonsOf = ({type, coordinates}) => (type === 'Polygon' ? [coordinates] : coordinates);
export const ringsOf = geometry => polygonsOf(geometry).flat();

// How far a finger reaches on the ground at this zoom.
export function reachMetres(coordinate, map) {
  const {x, y} = map.project(coordinate);
  const {lng, lat} = map.unproject([x + reachPixels, y]);
  return distanceMetres(coordinate, [lng, lat]);
}

const metresPerDegree = 111200;

function widened([west, south, east, north], metres) {
  const latitudeMargin = metres / metresPerDegree;
  const longitudeMargin = latitudeMargin / Math.cos((south * Math.PI) / 180);
  return [west - longitudeMargin, south - latitudeMargin, east + longitudeMargin, north + latitudeMargin];
}

// The other areas of the same file around a place or a shape. What only frames the map, such as the sea, is none of them.
export function neighbouringAreas(geometry, {filename, key}, context, marginMetres = 0) {
  const rule = context.rules.layers[filename];
  const bounds = widened(boundsOf({geometry}), marginMetres);
  return entriesWithin(context.entriesOf(filename), bounds).filter(
    entry => entry.key !== key && isArea(entry.feature.geometry) && featureCapabilities(entry.feature, rule).canReshape
  );
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

const cornersOf = entries => entries.flatMap(({feature}) => ringsOf(feature.geometry).flatMap(ring => ring.slice(0, -1)));

function nearestCorner(coordinate, corners) {
  return nearestOf(corners.map(corner => ({target: corner, distance: distanceMetres(corner, coordinate)})));
}

function nearestSide(coordinate, entries) {
  const outlines = entries.map(({feature}) => nearestPointOnOutline(coordinate, ringsOf(feature.geometry)));
  return nearestOf(outlines.map(({coordinate: target, distanceMetres: distance}) => ({target, distance})));
}

// Where a point goes: to the nearest corner within reach, otherwise onto the nearest side, or null.
export function magneticPoint(coordinate, entries, reach) {
  const corner = nearestCorner(coordinate, cornersOf(entries));
  if (corner.distance <= reach) return corner.target;
  const side = nearestSide(coordinate, entries);
  return side.distance <= reach ? roundedCoordinate(side.target) : null;
}

// A whole area goes to its neighbours with the corner that is closest to one of theirs, otherwise to a side.
export function magneticallyMoved(geometry, entries, reach) {
  const own = ringsOf(geometry).flatMap(ring => ring.slice(0, -1));
  const corners = cornersOf(entries);
  const toCorner = nearestOf(own.map(corner => ({corner, ...nearestCorner(corner, corners)})));
  const toSide = () => nearestOf(own.map(corner => ({corner, ...nearestSide(corner, entries)})));
  const closest = toCorner.distance <= reach ? toCorner : toSide();
  if (closest.distance > reach) return geometry;
  const {corner, target} = closest;
  return translateGeometry(geometry, target[0] - corner[0], target[1] - corner[1]);
}
