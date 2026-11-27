// A ridge is one drawn fact: it lies inside one green area and each end meets that area's outline or another ridge.
// Ported from data/tools/ridge-topology.mjs so the Editor and the data checks apply the same rule before release.
export const END_TOLERANCE_DEGREES = 0.00001;

// The message stays the data check's own text; the fields let the Editor speak about the ridge without parsing an ID.
const topologyError = (label, detail) => Object.assign(new Error(`${label}: ${detail}`), {label, detail});

// The green-area polygons this feature describes, or none for another kind or geometry.
export function featurePolygons(feature, greenKinds) {
  const kind = feature.properties?.kind;
  if (!greenKinds.has(kind)) return [];
  const {type, coordinates} = feature.geometry ?? {};
  if (type === 'Polygon') return [coordinates];
  if (type === 'MultiPolygon') return coordinates;
  return [];
}

const segments = ring => ring.slice(0, -1).map((point, index) => [point, ring[index + 1]]);

// Whether a point lies on a segment within the given degrees of tolerance.
export function pointOnSegment(point, [start, end], tolerance) {
  const deltaLongitude = end[0] - start[0];
  const deltaLatitude = end[1] - start[1];
  const lengthSquared = deltaLongitude ** 2 + deltaLatitude ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]) <= tolerance;
  }
  const fraction = (
    (point[0] - start[0]) * deltaLongitude + (point[1] - start[1]) * deltaLatitude
  ) / lengthSquared;
  if (fraction < 0 || fraction > 1) return false;
  return Math.hypot(
    point[0] - (start[0] + fraction * deltaLongitude),
    point[1] - (start[1] + fraction * deltaLatitude)
  ) <= tolerance;
}

// Whether a point is inside one closed ring, ignoring points on its outline.
function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [longitude, latitude] = ring[index];
    const [nextLongitude, nextLatitude] = ring[index + 1];
    if ((latitude > point[1]) !== (nextLatitude > point[1])
      && point[0] < (nextLongitude - longitude) * (point[1] - latitude)
        / (nextLatitude - latitude) + longitude) {
      inside = !inside;
    }
  }
  return inside;
}

// Whether a point is inside a shell and outside all its holes.
function pointInPolygon(point, rings) {
  return pointInRing(point, rings[0]) && rings.slice(1).every(ring => !pointInRing(point, ring));
}

// Whether two segments meet away from each other's ends, which would take a ridge outside its green area.
function segmentsCross(firstSegment, secondSegment) {
  const orientation = (origin, firstPoint, secondPoint) => (
    (firstPoint[0] - origin[0]) * (secondPoint[1] - origin[1])
    - (firstPoint[1] - origin[1]) * (secondPoint[0] - origin[0])
  );
  const [firstStart, firstEnd] = firstSegment;
  const [secondStart, secondEnd] = secondSegment;
  const firstStartSide = Math.sign(orientation(secondStart, secondEnd, firstStart));
  const firstEndSide = Math.sign(orientation(secondStart, secondEnd, firstEnd));
  const secondStartSide = Math.sign(orientation(firstStart, firstEnd, secondStart));
  const secondEndSide = Math.sign(orientation(firstStart, firstEnd, secondEnd));
  if (firstStartSide === 0 && firstEndSide === 0) return false;
  // Collinear touches stay candidates; the caller rejects contacts at a segment end.
  return firstStartSide * firstEndSide <= 0 && secondStartSide * secondEndSide <= 0;
}

// Whether every point and part of a ridge stays in one green area, allowing points on its outline.
export function ridgeInsidePolygon(coordinates, rings, tolerance) {
  const outline = rings.flatMap(segments);
  for (const point of coordinates) {
    const onOutline = outline.some(segment => pointOnSegment(point, segment, tolerance));
    if (!onOutline && !pointInPolygon(point, rings)) return false;
  }
  for (const segment of segments(coordinates)) {
    if (outline.some(outlineSegment => segmentsCross(segment, outlineSegment)
      && !pointOnSegment(segment[0], outlineSegment, tolerance)
      && !pointOnSegment(segment[1], outlineSegment, tolerance))) return false;
  }
  return true;
}

// The shortest distance in degrees from a point to a segment, clamped to its ends.
export function distanceToSegment(point, segment) {
  const [start, end] = segment;
  const deltaLongitude = end[0] - start[0];
  const deltaLatitude = end[1] - start[1];
  const lengthSquared = deltaLongitude ** 2 + deltaLatitude ** 2;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const fraction = Math.max(0, Math.min(1, (
    (point[0] - start[0]) * deltaLongitude + (point[1] - start[1]) * deltaLatitude
  ) / lengthSquared));
  return Math.hypot(
    point[0] - (start[0] + fraction * deltaLongitude),
    point[1] - (start[1] + fraction * deltaLatitude)
  );
}

// The coordinate list of a LineString ridge, or null for a different geometry.
export function ridgeCoordinates(feature) {
  if (feature.geometry?.type !== 'LineString') return null;
  return feature.geometry.coordinates;
}

function greenPolygons(land, greenKinds) {
  const polygons = [];
  for (const feature of land.features) {
    for (const rings of featurePolygons(feature, greenKinds)) {
      polygons.push({label: feature.properties.entityId ?? 'green area', rings});
    }
  }
  return polygons;
}

function ridgeLines(ridges) {
  return ridges.features.map(feature => ({
    label: feature.properties.entityId ?? 'ridge',
    coordinates: ridgeCoordinates(feature)
  }));
}

function assertLines(lines) {
  for (const line of lines) {
    if (!line.coordinates || line.coordinates.length < 2) {
      throw topologyError(line.label, 'ridge must be a LineString with two or more positions');
    }
  }
}

// Each ridge paired with the green areas that contain all of it.
function assignedPolygons(lines, polygons, tolerance) {
  return lines.map(line => ({
    line,
    polygons: polygons.filter(polygon => ridgeInsidePolygon(
      line.coordinates, polygon.rings, tolerance
    ))
  }));
}

// Refuses a ridge whose end touches neither its area's outline nor another ridge in that area.
function assertEnds(assignment, tolerance) {
  for (const {line, polygons: candidates} of assignment) {
    const [area] = candidates;
    const outline = area.rings.flatMap(segments);
    const otherLines = assignment
      .filter(entry => entry.line !== line && entry.polygons[0] === area)
      .map(entry => entry.line.coordinates);
    for (const end of [line.coordinates[0], line.coordinates.at(-1)]) {
      const onOutline = outline.some(segment => pointOnSegment(end, segment, tolerance));
      const onRidge = otherLines.some(coordinates => segments(coordinates)
        .some(segment => distanceToSegment(end, segment) <= tolerance));
      if (!onOutline && !onRidge) {
        throw topologyError(line.label, 'ridge end is not on the green area outline or another ridge');
      }
    }
  }
}

// The shared structural rule, kept identical to the data check. The Editor uses the same messages in its inspector.
export function validateRidgeTopology(land, ridges, greenKinds, {
  tolerance = END_TOLERANCE_DEGREES
} = {}) {
  const lines = ridgeLines(ridges);
  assertLines(lines);
  const assignment = assignedPolygons(lines, greenPolygons(land, greenKinds), tolerance);
  for (const {line, polygons: candidates} of assignment) {
    if (candidates.length === 0) {
      throw topologyError(line.label, 'ridge is outside a green area');
    }
    if (candidates.length > 1) {
      throw topologyError(line.label, 'ridge lies in more than one green area');
    }
  }
  assertEnds(assignment, tolerance);
  return lines.length;
}

// The one green area the drawn ridge belongs to, for finding where its ends may go.
export function greenAreaOf(coordinates, land, greenKinds, {tolerance = END_TOLERANCE_DEGREES} = {}) {
  return greenPolygons(land, greenKinds).find(polygon =>
    ridgeInsidePolygon(coordinates, polygon.rings, tolerance)) ?? null;
}

// Lines an end may lie on: the outline of its green area and the other ridges in that area.
export function endTargetsOf(coordinates, land, ridges, greenKinds, {tolerance = END_TOLERANCE_DEGREES} = {}) {
  const area = greenAreaOf(coordinates, land, greenKinds, {tolerance});
  if (!area) return [];
  const outline = area.rings.flatMap(segments);
  const others = ridgeLines(ridges)
    .filter(line => line.coordinates)
    .filter(line => ridgeInsidePolygon(line.coordinates, area.rings, tolerance))
    .flatMap(line => segments(line.coordinates));
  return [...outline, ...others];
}
