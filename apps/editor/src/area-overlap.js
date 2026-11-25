// Whether two areas share ground. Walls and borders that only touch do not: sources are rounded, so a little is allowed.
import {polygonsOf} from './area-magnet.js';
import {interiorPoint} from './interior-point.js';
import {metricOffset, nearestPointOnOutline} from './geometry-measures.js';
import {pointInsidePolygon} from './geometry-validation.js';

const toleranceMetres = 0.05;

const edgesOf = rings => rings.flatMap(ring => ring.slice(1).map((end, index) => [ring[index], end]));

const isDeepInside = (point, rings) =>
  pointInsidePolygon(point, rings) && nearestPointOnOutline(point, rings).distanceMetres > toleranceMetres;

function mayMeet([start, end], [otherStart, otherEnd], margin = 1e-6) {
  const isApart = axis =>
    Math.max(start[axis], end[axis]) + margin < Math.min(otherStart[axis], otherEnd[axis]) ||
    Math.max(otherStart[axis], otherEnd[axis]) + margin < Math.min(start[axis], end[axis]);
  return !isApart(0) && !isApart(1);
}

const cross = (first, second) => first[0] * second[1] - first[1] * second[0];

// How far along an edge another one crosses its line, as a fraction, or null when they are parallel.
function crossingFraction([start, end], [otherStart, otherEnd]) {
  const direction = metricOffset(end, start);
  const otherDirection = metricOffset(otherEnd, otherStart);
  const between = metricOffset(otherStart, start);
  const denominator = cross(direction, otherDirection);
  if (denominator === 0) return null;
  const otherFraction = cross(between, direction) / denominator;
  return otherFraction >= 0 && otherFraction <= 1 ? cross(between, otherDirection) / denominator : null;
}

// How far along an edge a point is.
function fractionOf(point, [start, end]) {
  const direction = metricOffset(end, start);
  const offset = metricOffset(point, start);
  const squaredLength = direction[0] ** 2 + direction[1] ** 2;
  return squaredLength === 0 ? null : (offset[0] * direction[0] + offset[1] * direction[1]) / squaredLength;
}

// The middles of the stretches into which an outline is cut by another one.
function stretchMiddles(rings, otherEdges) {
  return edgesOf(rings).flatMap(edge => {
    const [start, end] = edge;
    const meeting = otherEdges.filter(otherEdge => mayMeet(edge, otherEdge));
    const cuts = meeting.flatMap(otherEdge => [crossingFraction(edge, otherEdge), ...otherEdge.map(point => fractionOf(point, edge))]);
    const inner = cuts.filter(fraction => fraction !== null && fraction > 0 && fraction < 1);
    const fractions = [0, ...inner.toSorted((first, second) => first - second), 1];
    return fractions.slice(1).map((fraction, index) => {
      const middle = (fraction + fractions[index]) / 2;
      return [start[0] + middle * (end[0] - start[0]), start[1] + middle * (end[1] - start[1])];
    });
  });
}

const reachesInto = (rings, otherRings) =>
  stretchMiddles(rings, edgesOf(otherRings)).some(point => isDeepInside(point, otherRings));

function doPolygonsOverlap(rings, otherRings, isInsideAllowed) {
  const isIn = reachesInto(rings, otherRings);
  const isOtherIn = reachesInto(otherRings, rings);
  if (isIn && isOtherIn) return true;
  // One is inside the other, or both are the same.
  if (isIn || isOtherIn) return !isInsideAllowed;
  return isDeepInside(interiorPoint(rings), otherRings);
}

// A part of a city is inside the city, so for some kinds an area inside another one is no overlap.
export function doOverlap(geometry, otherGeometry, isInsideAllowed) {
  return polygonsOf(geometry).some(rings =>
    polygonsOf(otherGeometry).some(otherRings => doPolygonsOverlap(rings, otherRings, isInsideAllowed))
  );
}
