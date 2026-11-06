// The same ring and line rules as the data importer, kept honest by the shared fixture
// packages/contracts/fixtures/editor-geometry-cases.json. The importer stays the final authority.

// Source coordinates have at most six or so decimals, so a smaller cross product can only mean collinear points.
const collinearToleranceDegreesSquared = 1e-13;

export const isValidCoordinate = coordinate =>
  Array.isArray(coordinate) &&
  coordinate.length === 2 &&
  coordinate.every(Number.isFinite) &&
  Math.abs(coordinate[0]) <= 180 &&
  Math.abs(coordinate[1]) <= 90;

// Twice the signed area of a triangle, in degrees squared; near zero means the points are collinear.
function crossProduct(first, second, third) {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

function pointTouchesSegment(start, end, point) {
  const isCollinear = Math.abs(crossProduct(start, end, point)) < collinearToleranceDegreesSquared;
  const isInsideBounds =
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1]);
  return isCollinear && isInsideBounds;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const isSecondAcrossFirst =
    crossProduct(firstStart, firstEnd, secondStart) * crossProduct(firstStart, firstEnd, secondEnd) < 0;
  const isFirstAcrossSecond =
    crossProduct(secondStart, secondEnd, firstStart) * crossProduct(secondStart, secondEnd, firstEnd) < 0;
  if (isSecondAcrossFirst && isFirstAcrossSecond) return true;
  return (
    pointTouchesSegment(firstStart, firstEnd, secondStart) ||
    pointTouchesSegment(firstStart, firstEnd, secondEnd) ||
    pointTouchesSegment(secondStart, secondEnd, firstStart) ||
    pointTouchesSegment(secondStart, secondEnd, firstEnd)
  );
}

function ringHasIntersectingEdges(ring) {
  const edgeCount = ring.length - 1;
  for (let first = 0; first < edgeCount; first += 1) {
    for (let second = first + 2; second < edgeCount; second += 1) {
      const isClosingNeighbor = first === 0 && second === edgeCount - 1;
      if (isClosingNeighbor) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) return true;
    }
  }
  return false;
}

// Returns why a closed ring is unusable, or null.
export function ringProblem(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 'ring needs at least three corners';
  if (!ring.every(isValidCoordinate)) return 'ring has an invalid coordinate';
  if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) return 'ring is not closed';
  const corners = ring.slice(0, -1);
  if (new Set(corners.map(String)).size !== corners.length) return 'ring repeats a corner';
  if (ringHasIntersectingEdges(ring)) return 'ring edges cross or touch';
  const twiceArea = corners.reduce((area, corner, index) => {
    const next = ring[index + 1];
    return area + corner[0] * next[1] - next[0] * corner[1];
  }, 0);
  return Math.abs(twiceArea) < collinearToleranceDegreesSquared ? 'ring has no area' : null;
}

// Returns why an open line is unusable, or null.
export function lineProblem(line) {
  if (!Array.isArray(line) || line.length < 2) return 'line needs at least two points';
  if (!line.every(isValidCoordinate)) return 'line has an invalid coordinate';
  return new Set(line.map(String)).size < 2 ? 'line needs two distinct points' : null;
}

function ringsCross(firstRing, secondRing) {
  for (let first = 0; first < firstRing.length - 1; first += 1) {
    for (let second = 0; second < secondRing.length - 1; second += 1) {
      if (segmentsIntersect(firstRing[first], firstRing[first + 1], secondRing[second], secondRing[second + 1])) {
        return true;
      }
    }
  }
  return false;
}

// Ray casting: a horizontal ray from the point crosses a ring's edges an odd number of times when inside.
function pointInsideRing([longitude, latitude], ring) {
  let isInside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [startLongitude, startLatitude] = ring[index];
    const [endLongitude, endLatitude] = ring[previous];
    const spansLatitude = startLatitude > latitude !== endLatitude > latitude;
    if (!spansLatitude) continue;
    const crossingLongitude =
      startLongitude + ((latitude - startLatitude) / (endLatitude - startLatitude)) * (endLongitude - startLongitude);
    if (longitude < crossingLongitude) isInside = !isInside;
  }
  return isInside;
}

// Returns why a polygon's rings do not form one shape with holes, or null.
export function polygonProblem(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return 'polygon has no rings';
  const invalidRing = rings.map(ringProblem).find(Boolean);
  if (invalidRing) return invalidRing;
  const [outerRing, ...holes] = rings;
  if (holes.some(hole => !hole.every(corner => pointInsideRing(corner, outerRing)))) {
    return 'hole is outside its polygon';
  }
  for (let first = 0; first < rings.length; first += 1) {
    for (let second = first + 1; second < rings.length; second += 1) {
      if (ringsCross(rings[first], rings[second])) return 'polygon rings cross or touch';
    }
  }
  return null;
}

// Inside the outer ring and outside every hole.
export function pointInsidePolygon(point, rings) {
  const [outerRing, ...holes] = rings;
  return pointInsideRing(point, outerRing) && !holes.some(hole => pointInsideRing(point, hole));
}
