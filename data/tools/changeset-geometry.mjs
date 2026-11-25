// Geometry rules of an editor changeset. The editor applies the same rules to the same shared fixture.
import {isInsideRing} from './ring-geometry.mjs';

// Source coordinates have at most six or so decimals, so a smaller cross product can only mean collinear points.
const collinearToleranceDegreesSquared = 1e-13;

const isValidCoordinate = coordinate =>
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

// Cheap, and true for almost every pair of edges of a long outline.
function areSegmentsApart(firstStart, firstEnd, secondStart, secondEnd) {
  return [0, 1].some(
    axis =>
      Math.max(firstStart[axis], firstEnd[axis]) < Math.min(secondStart[axis], secondEnd[axis]) ||
      Math.max(secondStart[axis], secondEnd[axis]) < Math.min(firstStart[axis], firstEnd[axis])
  );
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  if (areSegmentsApart(firstStart, firstEnd, secondStart, secondEnd)) return false;
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

// Returns why a closed ring is unusable, or null. The editor applies the same rules to the same shared fixture.
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

// Returns why a set of separate polygons is unusable, or null.
function multiPolygonProblem(polygons) {
  if (!Array.isArray(polygons) || polygons.length === 0) return 'shape has no polygons';
  return polygons.map(polygonProblem).find(Boolean) ?? null;
}

const problemByGeometryType = {
  Point: coordinates => (isValidCoordinate(coordinates) ? null : 'point is not a WGS84 coordinate'),
  LineString: lineProblem,
  Polygon: polygonProblem,
  MultiPolygon: multiPolygonProblem
};

// Returns why this geometry cannot be recorded, or null. "None" stands for a record without geometry, such as a route.
export function geometryProblem(geometry, allowedTypes) {
  const geometryType = geometry === null ? 'None' : geometry?.type;
  if (!allowedTypes.includes(geometryType)) return `geometry type ${geometryType} is not editable in this file`;
  return problemByGeometryType[geometryType]?.(geometry.coordinates) ?? null;
}

const isClosedRing = ring =>
  Array.isArray(ring) &&
  ring.length >= 4 &&
  ring.every(isValidCoordinate) &&
  JSON.stringify(ring[0]) === JSON.stringify(ring.at(-1));

// A derived shape, such as a municipality rebuilt from its shared edges, can have thousands of corners and touch itself
// at one of them. Its topology is checked by check-shared-edges.py, so only its structure is judged here.
export function derivedGeometryProblem(geometry, allowedTypes) {
  if (!allowedTypes.includes(geometry?.type)) return `geometry type ${geometry?.type} is not editable in this file`;
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings = polygons.flat();
  return rings.length > 0 && rings.every(isClosedRing) ? null : 'derived shape has an open or invalid ring';
}

function pointOnRingEdge(point, ring) {
  return ring.slice(0, -1).some(
    (start, index) => pointTouchesSegment(start, ring[index + 1], point)
  );
}

// A mark on an edge is still inside its area, including the edge of a hole.
function isPointInsideRing(point, ring) {
  return isInsideRing(point, ring) || pointOnRingEdge(point, ring);
}

function isPointInsidePolygon(point, rings) {
  return isPointInsideRing(point, rings[0])
    && !rings.slice(1).some(ring => isPointInsideRing(point, ring));
}

function isPointInsideGeometry(point, geometry) {
  if (geometry?.type === 'Polygon') {
    return isPointInsidePolygon(point, geometry.coordinates);
  }
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some(rings => isPointInsidePolygon(point, rings));
  }
  return false;
}

// A municipality mark may move, but never into another municipality or outside its own polygon.
export function municipalityLabelPointProblem(operation) {
  if (operation.filename !== 'municipalities.geojson' || !operation.after) return null;
  const {kind, labelPoint} = operation.after.properties;
  if (!['municipality', 'unassigned-water'].includes(kind)) return null;
  return isPointInsideGeometry(labelPoint, operation.after.geometry)
    ? null
    : 'labelPoint is outside its area';
}
