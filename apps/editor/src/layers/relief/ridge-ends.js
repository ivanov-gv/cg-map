// The ends of a ridge lie on the outline of its hill, where light and shade meet it. An end can slide along that outline:
// what it passes goes from one side to the other.
import {roundedCoordinate} from '../../geometry/geometry-editing.js';
import {distanceMetres, nearestPointOnLine} from '../../geometry/geometry-measures.js';
import {restOfRing, tolerancesUpTo} from '../../geometry/shared-shapes.js';
import {isSamePoint} from '../roads/road-shapes.js';

const slopesOfRidge = 2;
// The ends of a ridge cannot meet: there would be nothing left of one side.
const shortestOutlineMetres = 5;

const isClosed = line => isSamePoint(line[0], line.at(-1));

// The slopes whose outer outline runs along the whole ridge: [{entry, outline}], with the rest of the outline from the end
// of the ridge back to its start.
function slopesAlong(line, slopes, toleranceMetres) {
  return slopes.flatMap(entry => {
    if (entry.feature.geometry.type !== 'Polygon') return [];
    const outline = restOfRing(entry.feature.geometry.coordinates[0], line, toleranceMetres);
    return outline ? [{entry, outline}] : [];
  });
}

// Both sides of a ridge, or null where they cannot be told: a ridge around an enclosed slope has no ends.
export function sidesOfRidge(line, slopes, toleranceMetres) {
  if (isClosed(line)) return null;
  for (const tolerance of tolerancesUpTo(toleranceMetres)) {
    const sides = slopesAlong(line, slopes, tolerance);
    if (sides.length === slopesOfRidge) return sides;
  }
  return null;
}

// The outline of the hill as one line, from the start of the ridge along the first side to its end and along the other
// side back. Positions on it are {coordinate, segmentIndex}.
const hillOutline = ([first, second]) => [...first.outline.toReversed(), ...second.outline.slice(1)];

const lengthOf = points => points.slice(1).reduce((length, point, index) => length + distanceMetres(points[index], point), 0);

function partOfOutline(line, from, to) {
  return [from.coordinate, ...line.slice(from.segmentIndex + 1, to.segmentIndex + 1), to.coordinate];
}

const isBefore = (first, second, line) =>
  first.segmentIndex < second.segmentIndex ||
  (first.segmentIndex === second.segmentIndex &&
    distanceMetres(line[first.segmentIndex], first.coordinate) <= distanceMetres(line[first.segmentIndex], second.coordinate));

const placeOn = (line, coordinate) => {
  const {coordinate: place, segmentIndex} = nearestPointOnLine(coordinate, line);
  return {coordinate: roundedCoordinate(place), segmentIndex};
};

// Where an end goes when it is dragged: to the nearest place of the outline that leaves something of both sides.
export function slidEnd(coordinate, otherEnd, sides) {
  const outline = hillOutline(sides);
  const place = placeOn(outline, coordinate);
  const other = placeOn(outline, otherEnd);
  const [first, second] = isBefore(place, other, outline) ? [place, other] : [other, place];
  const between = lengthOf(partOfOutline(outline, first, second));
  const around = lengthOf(outline) - between;
  return Math.min(between, around) < shortestOutlineMetres ? null : place.coordinate;
}

const withoutRepeats = points => points.filter((point, index) => index === 0 || !isSamePoint(point, points[index - 1]));

const closedRing = points => {
  const corners = withoutRepeats(points);
  return isSamePoint(corners[0], corners.at(-1)) ? [...corners.slice(0, -1), corners[0]] : [...corners, corners[0]];
};

// The outline between the ends on the side of `inner`, from the end of the ridge back to its start. The loop begins where
// the ridge starts, which is on neither side.
function outlineOfSide(outline, start, end, isFirstSide) {
  const loop = outline.slice(0, -1);
  const turned = isFirstSide ? [...loop, loop[0]] : [...loop, loop[0]].toReversed();
  const from = placeOn(turned, start);
  // Read on from the start of the ridge, so that a start which slid backwards is still before the end.
  const fromStart = [from.coordinate, ...turned.slice(from.segmentIndex + 1, -1), ...turned.slice(0, from.segmentIndex + 1), from.coordinate];
  const to = placeOn(fromStart, end);
  return [...fromStart.slice(0, to.segmentIndex + 1), to.coordinate].toReversed();
}

// The slopes with the ridge where it is now, when one of its ends slid along the outline.
export function slopesWithSlidEnds(line, sides) {
  const outline = hillOutline(sides);
  return sides.map(({entry}, index) => {
    const side = outlineOfSide(outline, line[0], line.at(-1), index === 0);
    const [, ...holes] = entry.feature.geometry.coordinates;
    const geometry = {...entry.feature.geometry, coordinates: [closedRing([...line, ...side.slice(1)]), ...holes]};
    return {filename: entry.filename, key: entry.key, after: {...entry.feature, geometry}};
  });
}

export const hasMovedEnds = (before, after) =>
  !isSamePoint(before[0], after[0]) || !isSamePoint(before.at(-1), after.at(-1));

const containsPoint = (line, point) => line.some(candidate => isSamePoint(candidate, point));

// An end lies where light and shade meet the hill outline. A point further along the ridge cannot take its place
// without leaving that outline, so taking an end away is not a corner edit but a different ridge. The editor's origins
// say which point each position is: without them, as in a tool that replaces the line, position is all there is to go by.
export function isEndRemoved(before, after, origins) {
  if (!Array.isArray(after) || after.length < 2) return true;
  if (origins) return origins[0] !== 0 || origins.at(-1) !== before.length - 1;
  const innerPoints = before.slice(1, -1);
  const isStartRemoved =
    !containsPoint(after, before[0]) && innerPoints.some(point => isSamePoint(after[0], point));
  const isLastRemoved =
    !containsPoint(after, before.at(-1)) && innerPoints.some(point => isSamePoint(after.at(-1), point));
  return isStartRemoved || isLastRemoved;
}
