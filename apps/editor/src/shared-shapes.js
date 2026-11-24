// Shapes that follow a line: the sea and the land follow the coastline, municipalities follow their border, light and
// shade follow the ridge. When the line changes, the matching stretch of their outlines is replaced by the new one.
import {distanceMetres, nearestPointOnLine} from './geometry-measures.js';
import {isSamePoint} from './road-shapes.js';

const isClosed = line => isSamePoint(line[0], line.at(-1));

// The part of a line that changed, between the points that stayed: {before, after}, or null when nothing did. The points
// that stayed at both ends are part of it, so it can be found again in other shapes.
export function changedStretch(before, after) {
  const shortest = Math.min(before.length, after.length);
  let sameAtStart = 0;
  while (sameAtStart < shortest && isSamePoint(before[sameAtStart], after[sameAtStart])) sameAtStart += 1;
  if (sameAtStart === before.length && sameAtStart === after.length) return null;
  let sameAtEnd = 0;
  const mostAtEnd = shortest - sameAtStart;
  while (sameAtEnd < mostAtEnd && isSamePoint(before.at(-1 - sameAtEnd), after.at(-1 - sameAtEnd))) sameAtEnd += 1;
  const from = Math.max(0, sameAtStart - 1);
  const stretchOf = line => line.slice(from, line.length - Math.max(0, sameAtEnd - 1));
  return {before: stretchOf(before), after: stretchOf(after)};
}

function nearestIndex(points, coordinate) {
  let nearest = {index: -1, distance: Infinity};
  points.forEach((point, index) => {
    const distance = distanceMetres(point, coordinate);
    if (distance < nearest.distance) nearest = {index, distance};
  });
  return nearest;
}

// How far a run of points strays from a line, at most.
function farthestFrom(points, line) {
  return Math.max(0, ...points.map(point => nearestPointOnLine(point, line).distanceMetres));
}

const joinedWithoutRepeats = points =>
  points.filter((point, index) => index === 0 || !isSamePoint(point, points[index - 1]));

// An open line with the stretch replaced, or null when it does not run along it.
export function splicedLine(line, {before, after}, toleranceMetres) {
  const start = nearestIndex(line, before[0]);
  const end = nearestIndex(line, before.at(-1));
  if (start.distance > toleranceMetres || end.distance > toleranceMetres || start.index === end.index) return null;
  const isSameDirection = start.index < end.index;
  const [from, to] = isSameDirection ? [start.index, end.index] : [end.index, start.index];
  if (farthestFrom(line.slice(from, to + 1), before) > toleranceMetres) return null;
  const replacement = isSameDirection ? after : after.toReversed();
  return joinedWithoutRepeats([...line.slice(0, from), ...replacement, ...line.slice(to + 1)]);
}

const closedRing = corners => [...corners, corners[0]];
// Rotating a ring to start at a corner lets both ways around it be read as plain lines.
const rotated = (corners, index) => [...corners.slice(index), ...corners.slice(0, index)];

// A ring with the stretch replaced, or null when it does not run along it. Of the two ways around between the ends of the
// stretch, the one that follows it is replaced.
export function splicedRing(ring, {before, after}, toleranceMetres) {
  const corners = ring.slice(0, -1);
  if (isClosed(before)) {
    const isSameRing = farthestFrom(corners, before) <= toleranceMetres;
    return isSameRing ? closedRing(joinedWithoutRepeats(after.slice(0, -1))) : null;
  }
  const start = nearestIndex(corners, before[0]);
  const end = nearestIndex(corners, before.at(-1));
  if (start.distance > toleranceMetres || end.distance > toleranceMetres || start.index === end.index) return null;
  const fromStart = rotated(corners, start.index);
  const endOffset = (end.index - start.index + corners.length) % corners.length;
  const forward = fromStart.slice(0, endOffset + 1);
  const backward = [...fromStart.slice(endOffset), fromStart[0]];
  const isForward = farthestFrom(forward, before) <= toleranceMetres;
  if (!isForward && farthestFrom(backward, before) > toleranceMetres) return null;
  const kept = isForward ? fromStart.slice(endOffset + 1) : forward.slice(1, -1);
  const replacement = isForward ? after : after.toReversed();
  const nextCorners = joinedWithoutRepeats(isForward ? [...replacement, ...kept] : [...kept, ...replacement]);
  const isClosedTwice = isSamePoint(nextCorners[0], nextCorners.at(-1));
  return closedRing(isClosedTwice ? nextCorners.slice(0, -1) : nextCorners);
}

function splicedRings(rings, stretch, toleranceMetres) {
  return rings.map(ring => splicedRing(ring, stretch, toleranceMetres) ?? ring);
}

// A geometry with every outline along the stretch following it, or the same geometry when none does.
export function followingGeometry(geometry, stretch, toleranceMetres) {
  if (geometry.type === 'LineString') {
    const coordinates = splicedLine(geometry.coordinates, stretch, toleranceMetres);
    return coordinates ? {...geometry, coordinates} : geometry;
  }
  const spliceRings = rings => splicedRings(rings, stretch, toleranceMetres);
  const coordinates =
    geometry.type === 'Polygon' ? spliceRings(geometry.coordinates) : geometry.coordinates.map(spliceRings);
  const isChanged = JSON.stringify(coordinates) !== JSON.stringify(geometry.coordinates);
  return isChanged ? {...geometry, coordinates} : geometry;
}

// Edits of every object of a file whose outline runs along the stretch.
export function followingEdits(entries, stretch, toleranceMetres) {
  return entries.flatMap(({filename, key, feature}) => {
    const geometry = followingGeometry(feature.geometry, stretch, toleranceMetres);
    return geometry === feature.geometry ? [] : [{filename, key, after: {...feature, geometry}}];
  });
}
