// Shapes that follow a line: the sea and the land follow the coastline, municipalities follow their border, light and
// shade follow the ridge. When the line changes, the matching stretch of their outlines is replaced by the new one.
import {roundedCoordinate} from './geometry-editing.js';
import {hasNewCrossing} from './geometry-validation.js';
import {nearestPointOnLine} from './geometry-measures.js';
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

// How far a run of points strays from a line, at most.
function farthestFrom(points, line) {
  return Math.max(0, ...points.map(point => nearestPointOnLine(point, line).distanceMetres));
}

// How far two lines are apart, seen from both: a line that cuts a corner of the other strays from it too.
const distanceBetween = (first, second) => Math.max(farthestFrom(first, second), farthestFrom(second, first));

const joinedWithoutRepeats = points =>
  points.filter((point, index) => index === 0 || !isSamePoint(point, points[index - 1]));

// Where a line passes near a point: the nearest place of every pass, as {coordinate, segmentIndex}. A bay or a river mouth
// can bring an outline past the same point twice.
function passesNear(line, coordinate, toleranceMetres) {
  const passes = [];
  let pass = null;
  for (let segmentIndex = 0; segmentIndex < line.length - 1; segmentIndex += 1) {
    const segment = [line[segmentIndex], line[segmentIndex + 1]];
    const near = {...nearestPointOnLine(coordinate, segment), segmentIndex};
    if (near.distanceMetres > toleranceMetres) pass = null;
    else if (!pass) {
      pass = near;
      passes.push(pass);
    } else if (near.distanceMetres < pass.distanceMetres) Object.assign(pass, near);
  }
  return passes;
}

// A line with a corner at a place on it, and the index of that corner.
function withCornerAt(line, {coordinate, segmentIndex}) {
  const corner = roundedCoordinate(coordinate);
  for (const index of [segmentIndex, segmentIndex + 1]) {
    if (isSamePoint(line[index], corner)) return {line, index};
  }
  return {line: line.toSpliced(segmentIndex + 1, 0, corner), index: segmentIndex + 1};
}

// The closest of the runs along the stretch, or null when none stays within the tolerance.
function closestRun(runs, before, toleranceMetres) {
  let closest = null;
  for (const run of runs) {
    const distance = distanceBetween(run.points, before);
    if (distance <= toleranceMetres && (!closest || distance < closest.distance)) closest = {...run, distance};
  }
  return closest;
}

// Every part of a line between a pass near one end of the stretch and a pass near the other: {points, kept, isForward},
// where the kept points stand before and after it.
function runsOfLine(line, before, toleranceMetres) {
  const starts = passesNear(line, before[0], toleranceMetres);
  const ends = passesNear(line, before.at(-1), toleranceMetres);
  return starts.flatMap(start =>
    ends.flatMap(end => {
      const isForward = start.segmentIndex <= end.segmentIndex;
      const [first, second] = isForward ? [start, end] : [end, start];
      // The later corner goes in first, so it does not move the earlier one.
      const {line: withSecond} = withCornerAt(line, second);
      const {line: corners, index: from} = withCornerAt(withSecond, first);
      const to = corners.findIndex((point, index) => index > from && isSamePoint(point, second.coordinate));
      if (to < 0) return [];
      const points = corners.slice(from, to + 1);
      return [{points, isForward, kept: [corners.slice(0, from + 1), corners.slice(to)]}];
    })
  );
}

const inDirection = (points, isForward) => (isForward ? points : points.toReversed());

// Leaves out the points that a line got for the splice.
function cornersOf(line) {
  const names = new Set(line.map(String));
  return points => points.filter(point => names.has(String(point)));
}

// The outline meets the stretch at its nearest point. Where that little step between them would cross something, it goes
// from its own last corner straight to the stretch.
function withoutCrossing(line, variants) {
  return variants.find(variant => !hasNewCrossing([line], [variant])) ?? variants[0];
}

// An open line with the stretch replaced, or null when it does not run along it.
export function splicedLine(line, {before, after}, toleranceMetres) {
  const run = closestRun(runsOfLine(line, before, toleranceMetres), before, toleranceMetres);
  if (!run) return null;
  const [head, tail] = run.kept;
  const replacement = inDirection(after, run.isForward);
  const ownCorners = cornersOf(line);
  return withoutCrossing(line, [
    joinedWithoutRepeats([...head, ...replacement, ...tail]),
    joinedWithoutRepeats([...ownCorners(head), ...replacement, ...ownCorners(tail)])
  ]);
}

const closedRing = corners => [...corners, corners[0]];
// Rotating a ring to start at a corner lets both ways around it be read as plain lines.
const rotated = (corners, index) => [...corners.slice(index), ...corners.slice(0, index)];

// Both ways around a ring between a pass near one end of the stretch and a pass near the other.
function runsOfRing(ring, before, toleranceMetres) {
  const starts = passesNear(ring, before[0], toleranceMetres);
  return starts.flatMap(start => {
    const {line, index} = withCornerAt(ring, start);
    const fromStart = closedRing(rotated(line.slice(0, -1), index % (line.length - 1)));
    const ends = passesNear(fromStart, before.at(-1), toleranceMetres);
    return ends.flatMap(end => {
      const {line: corners, index: endIndex} = withCornerAt(fromStart, end);
      const forward = corners.slice(0, endIndex + 1);
      const backward = corners.slice(endIndex);
      return [
        {points: forward, isForward: true, kept: backward},
        {points: backward, isForward: false, kept: forward}
      ].filter(({points, kept}) => points.length > 1 && kept.length > 1);
    });
  });
}

// A ring with the stretch replaced, or null when it does not run along it. Of the two ways around between the ends of the
// stretch, the one that follows it is replaced.
export function splicedRing(ring, {before, after}, toleranceMetres) {
  if (isClosed(before)) return distanceBetween(ring, before) <= toleranceMetres ? after : null;
  const run = closestRun(runsOfRing(ring, before, toleranceMetres), before, toleranceMetres);
  if (!run) return null;
  // The kept part goes on from where the replaced part ends, and back to where it starts.
  const replacement = inDirection(after, run.isForward);
  const ringWith = kept => {
    const corners = joinedWithoutRepeats([...replacement, ...kept]);
    return closedRing(isSamePoint(corners[0], corners.at(-1)) ? corners.slice(0, -1) : corners);
  };
  return withoutCrossing(ring, [ringWith(run.kept), ringWith(cornersOf(ring)(run.kept))]);
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

// A short stretch lies near more outlines than its own, so the tightest of these that any outline follows within counts.
const tolerancesUpTo = toleranceMetres => [0.5, 5, 20].filter(value => value < toleranceMetres).concat(toleranceMetres);

// Edits of every object whose outline runs along the stretch.
export function followingEdits(entries, stretch, toleranceMetres) {
  for (const tolerance of tolerancesUpTo(toleranceMetres)) {
    const edits = editsWithin(entries, stretch, tolerance);
    if (edits.length > 0) return edits;
  }
  return [];
}

function editsWithin(entries, stretch, toleranceMetres) {
  return entries.flatMap(({filename, key, feature}) => {
    const geometry = followingGeometry(feature.geometry, stretch, toleranceMetres);
    return geometry === feature.geometry ? [] : [{filename, key, after: {...feature, geometry}}];
  });
}

const linesOf = ({type, coordinates}) => {
  if (type === 'LineString') return [coordinates];
  return type === 'Polygon' ? coordinates : coordinates.flat();
};

// Whether a shape crosses itself where it did not before, with its holes and its other parts.
export const crossesItself = (before, after) => hasNewCrossing(linesOf(before), linesOf(after));

// Whether an outline of one of these objects runs along a stretch, so that it must follow it.
export function hasOutlineAlong(entries, {before}, toleranceMetres) {
  return entries.some(({feature}) =>
    linesOf(feature.geometry).some(ring => farthestFrom(before, ring) <= toleranceMetres)
  );
}
