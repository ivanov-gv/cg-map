// JavaScript port of data/tools/relief/slope_faces.py. The build and the Editor must split the same green area the same
// way: a green area without ridges has no face, and a face's light comes from which side of its boundary ridge faces
// the sun. Only the geometry noding differs here: Shapely's union and polygonize become a small planar graph.
import {pointInsidePolygon} from '../../geometry/geometry-validation.js';
import {greenKinds} from '../../source-data/derived-facts.js';

export const SUN_AZIMUTH_DEGREES = 180;
export const MINIMUM_FACE_AREA_SQUARE_METRES = 2500;
export const METRES_PER_DEGREE_LATITUDE = 111320;

const coordinateScale = 1e10;
const fractionTolerance = 1e-10;
const parallelTolerance = 1e-15;
const areaTolerance = 1e-15;
const pointToleranceDegrees = 1e-10;
const radiansPerDegree = Math.PI / 180;
const maximumRingCleanupPasses = 3;
const representativeOffsetFraction = 1e-6;
const minimumRepresentativeOffsetDegrees = 1e-9;

// The coordinate rings of a polygon, or none for another geometry.
const polygonsOf = ({type, coordinates}) => {
  if (type === 'Polygon') return [coordinates];
  if (type === 'MultiPolygon') return coordinates;
  return [];
};

// The coordinate lists of a LineString or MultiLineString, or none for another geometry.
const linesOf = geometry => {
  if (geometry?.type === 'LineString') return [geometry.coordinates];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates;
  return [];
};

const rounded = value => Math.round(value * coordinateScale) / coordinateScale;
const pointKey = ([longitude, latitude]) => `${rounded(longitude)},${rounded(latitude)}`;
const samePoint = (first, second) => pointKey(first) === pointKey(second);
const segmentKey = (start, end) => [pointKey(start), pointKey(end)].sort().join('|');
const vectorBetween = (start, end) => [end[0] - start[0], end[1] - start[1]];
const crossProduct = (first, second) => first[0] * second[1] - first[1] * second[0];
const dotProduct = (first, second) => first[0] * second[0] + first[1] * second[1];
const clampedFraction = value => Math.max(0, Math.min(1, value));

const lineSegments = line => line.slice(1).map((end, index) => [line[index], end]);

// The edges of a closed ring, without a repeated final point.
function ringSegments(ring) {
  const corners = samePoint(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
  return corners.map((start, index) => [start, corners[(index + 1) % corners.length]]);
}

// The fractions along a segment where it meets another, including a shared collinear stretch.
function crossingFractions(start, end, otherStart, otherEnd) {
  const direction = vectorBetween(start, end);
  const otherDirection = vectorBetween(otherStart, otherEnd);
  const denominator = crossProduct(direction, otherDirection);
  const offset = vectorBetween(start, otherStart);
  if (Math.abs(denominator) < parallelTolerance) {
    if (Math.abs(crossProduct(offset, direction)) > parallelTolerance) return [];
    const squaredLength = dotProduct(direction, direction);
    const otherEndOffset = vectorBetween(start, otherEnd);
    return [dotProduct(offset, direction), dotProduct(otherEndOffset, direction)].map(
      projection => clampedFraction(projection / squaredLength)
    );
  }
  const fraction = crossProduct(offset, otherDirection) / denominator;
  const otherFraction = crossProduct(offset, direction) / denominator;
  const isOnBoth = value => value >= -fractionTolerance && value <= 1 + fractionTolerance;
  return isOnBoth(fraction) && isOnBoth(otherFraction) ? [clampedFraction(fraction)] : [];
}

// A segment cut at every crossing, sorted from its start to its end.
function splitAtIntersections([start, end], segments) {
  const fractions = [0, 1];
  for (const segment of segments) fractions.push(...crossingFractions(start, end, ...segment));
  const unique = [...new Set(fractions.map(fraction => Math.round(fraction * coordinateScale) / coordinateScale))];
  const ordered = unique.sort((first, second) => first - second);
  const pointAt = fraction => [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction
  ];
  return ordered.slice(1).map((fraction, index) => [pointAt(ordered[index]), pointAt(fraction)]);
}

// Whether a point is close enough to a segment to count as lying on it.
function pointIsNearSegment(point, [start, end]) {
  const direction = vectorBetween(start, end);
  const squaredLength = dotProduct(direction, direction);
  if (squaredLength === 0) return Math.hypot(...vectorBetween(start, point)) <= pointToleranceDegrees;
  const fraction = clampedFraction(dotProduct(vectorBetween(start, point), direction) / squaredLength);
  const nearest = [start[0] + direction[0] * fraction, start[1] + direction[1] * fraction];
  return Math.hypot(...vectorBetween(point, nearest)) <= pointToleranceDegrees;
}

// Whether a point is inside a green area or on its outline.
function isWithinArea(point, rings) {
  return pointInsidePolygon(point, rings) || rings.some(ring => ringSegments(ring).some(segment => pointIsNearSegment(point, segment)));
}

// The key of a noded point, adding it to the map at a fixed precision when it is new.
function nodeFor(point, nodes) {
  const key = pointKey(point);
  if (!nodes.has(key)) nodes.set(key, [rounded(point[0]), rounded(point[1])]);
  return key;
}

// Adds one graph edge, keeping boundary and ridge marks when the same edge was already seen.
function addEdge(edges, nodes, start, end, isBoundary, isRidgeHere) {
  const startKey = nodeFor(start, nodes);
  const endKey = nodeFor(end, nodes);
  if (startKey === endKey) return;
  const key = [startKey, endKey].sort().join('|');
  const existing = edges.get(key);
  if (existing) {
    existing.isBoundary ||= isBoundary;
    existing.isRidgeHere ||= isRidgeHere;
    return;
  }
  edges.set(key, {start: nodes.get(startKey), end: nodes.get(endKey), isBoundary, isRidgeHere});
}

// Every boundary and ridge segment, cut where any two meet. The nodes make crossings shared, as unary_union does.
function graphOf(rings, ridgeLines) {
  const boundarySegments = rings.flatMap(ringSegments).map(ends => ({ends, kind: 'boundary'}));
  const ridgeSegments = ridgeLines.flatMap(lineSegments).map(ends => ({ends, kind: 'ridge'}));
  const segments = [...boundarySegments, ...ridgeSegments];
  const nodes = new Map();
  for (const {ends} of segments) for (const point of ends) nodeFor(point, nodes);
  const edges = new Map();
  for (const {ends, kind} of segments) {
    for (const part of splitAtIntersections(ends, segments.map(segment => segment.ends))) {
      const middle = [(part[0][0] + part[1][0]) / 2, (part[0][1] + part[1][1]) / 2];
      const isHere = isWithinArea(middle, rings);
      // Clipping matters: a ridge crossing the area is only a seam between positions inside it.
      if (kind === 'ridge' && !isHere) continue;
      addEdge(edges, nodes, ...part, kind === 'boundary', kind === 'ridge' && isHere);
    }
  }
  return {nodes, edges: [...edges.values()]};
}

const angleFrom = (node, other) => Math.atan2(other[1] - node[1], other[0] - node[0]);

// Each node's edges in counterclockwise order, as half-edges keyed by their endpoints.
function outgoingByNode(nodes, edges) {
  const outgoing = new Map([...nodes.keys()].map(key => [key, []]));
  for (const edge of edges) {
    const startKey = pointKey(edge.start);
    const endKey = pointKey(edge.end);
    outgoing.get(startKey).push({key: `${startKey}>${endKey}`, to: endKey});
    outgoing.get(endKey).push({key: `${endKey}>${startKey}`, to: startKey});
  }
  for (const [key, halfEdges] of outgoing) {
    halfEdges.sort((first, second) =>
      angleFrom(nodes.get(key), nodes.get(first.to)) - angleFrom(nodes.get(key), nodes.get(second.to))
    );
  }
  return outgoing;
}

// Taking the outgoing edge just before the way back keeps the face on the left, so its ring winds counterclockwise.
function nextHalfEdges(outgoing) {
  const next = new Map();
  for (const [nodeKey, halfEdges] of outgoing) {
    for (const halfEdge of halfEdges) {
      const atDestination = outgoing.get(halfEdge.to);
      const reverse = atDestination.findIndex(candidate => candidate.to === nodeKey);
      const previous = atDestination[(reverse - 1 + atDestination.length) % atDestination.length];
      next.set(halfEdge.key, previous.key);
    }
  }
  return next;
}

// A ring without duplicate or doubled-back corners, which cannot bound a face.
function cleanRing(points) {
  let corners = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  for (let pass = 0; pass < maximumRingCleanupPasses; pass += 1) {
    let wasRemoved = false;
    for (let index = corners.length - 1; index >= 0; index -= 1) {
      if (corners.length <= 3) break;
      const previous = corners[(index - 1 + corners.length) % corners.length];
      const next = corners[(index + 1) % corners.length];
      if (samePoint(previous, next)) {
        corners.splice(index, 1);
        wasRemoved = true;
      }
    }
    corners = corners.filter((point, index) => index === 0 || !samePoint(point, corners[index - 1]));
    if (!wasRemoved) break;
  }
  return corners;
}

// The closed rings of the planar graph, each with a real area.
function cyclesOf(nodes, edges) {
  const next = nextHalfEdges(outgoingByNode(nodes, edges));
  const unvisited = new Set(next.keys());
  const cycles = [];
  for (const start of next.keys()) {
    if (!unvisited.has(start)) continue;
    const points = [];
    let current = start;
    while (unvisited.has(current)) {
      unvisited.delete(current);
      points.push(nodes.get(current.split('>')[0]));
      current = next.get(current);
    }
    const ring = cleanRing(points);
    if (ring.length >= 3 && Math.abs(ringSignedAreaDegrees(ring)) > areaTolerance) cycles.push(ring);
  }
  return cycles;
}

// The signed area of a ring in square degrees, positive when it winds counterclockwise.
function ringSignedAreaDegrees(ring) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    twiceArea += start[0] * end[1] - end[0] * start[1];
  }
  return twiceArea / 2;
}

// The area centroid of a ring, or its first point when the ring has no area.
function ringCentroid(ring) {
  let twiceArea = 0;
  let east = 0;
  let north = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const cross = start[0] * end[1] - end[0] * start[1];
    twiceArea += cross;
    east += (start[0] + end[0]) * cross;
    north += (start[1] + end[1]) * cross;
  }
  if (Math.abs(twiceArea) < areaTolerance) return ring[0];
  return [east / (3 * twiceArea), north / (3 * twiceArea)];
}

// West, south, east and north limits of a ring, for finding which ridges can reach it.
const ringBounds = ring => {
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
};

// The bounds of a drawn line, for skipping ridges that cannot reach a green area at all.
const lineBounds = line => {
  const longitudes = line.map(([longitude]) => longitude);
  const latitudes = line.map(([, latitude]) => latitude);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
};

// Whether two west/south/east/north boxes meet, touching edges included.
const boundsOverlap = ([west, south, east, north], [otherWest, otherSouth, otherEast, otherNorth]) =>
  west <= otherEast && otherWest <= east && south <= otherNorth && otherSouth <= north;

// A point safely inside a face: its centroid when possible, otherwise just inside an edge.
function representativePoint(rings) {
  const [shell] = rings;
  const centre = ringCentroid(shell);
  if (pointInsidePolygon(centre, rings)) return centre;
  const [west, south, east, north] = ringBounds(shell);
  const spanDegrees = Math.max(east - west, north - south);
  const offset = spanDegrees * representativeOffsetFraction || minimumRepresentativeOffsetDegrees;
  for (const [start, end] of ringSegments(shell)) {
    const direction = vectorBetween(start, end);
    const length = Math.hypot(...direction);
    if (length === 0) continue;
    const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    for (const side of [1, -1]) {
      const candidate = [middle[0] - side * direction[1] * offset / length, middle[1] + side * direction[0] * offset / length];
      if (pointInsidePolygon(candidate, rings)) return candidate;
    }
  }
  return null;
}

function facesFromCycles(cycles, greenRings) {
  // Only the counterclockwise cycles are faces inside the green area. The clockwise ones are outside it: the outer
  // face and the holes. A face with no ridge on its boundary stays flat and is left out of the published slopes.
  const shells = cycles.filter(ring => ringSignedAreaDegrees(ring) > areaTolerance);
  return shells.map(shell => {
    const contained = greenRings.slice(1).filter(hole => {
      const point = representativePoint([hole]);
      return point && pointInsidePolygon(point, [shell]);
    });
    return [shell, ...contained];
  });
}

// The boundary segments of a face that are ridges, for deciding which way the face looks.
function ridgeSegmentsOn(rings, edges) {
  const ridgeEdges = new Set(edges.filter(edge => edge.isRidgeHere).map(edge => segmentKey(edge.start, edge.end)));
  return rings.flatMap(ring => ringSegments(ring).filter(([start, end]) => ridgeEdges.has(segmentKey(start, end))));
}

// A point in metres east and north of the origin, so bearings can use ordinary trigonometry.
const metricPoint = (point, [longitudeScale, latitudeScale]) => [point[0] * longitudeScale, point[1] * latitudeScale];

// The light of a face: positive when its ridge side faces the sun, negative when it faces away, in metres. The ridge's
// own direction does not matter, because the side is taken from the face, not from how the line was drawn.
function faceAspect(point, segments, scales, azimuthDegrees) {
  const radians = azimuthDegrees * radiansPerDegree;
  const sun = [Math.sin(radians), Math.cos(radians)];
  const [pointEast, pointNorth] = metricPoint(point, scales);
  let sideVote = 0;
  let nearest = null;
  for (const [start, end] of segments) {
    const [startEast, startNorth] = metricPoint(start, scales);
    const [endEast, endNorth] = metricPoint(end, scales);
    const deltaEast = endEast - startEast;
    const deltaNorth = endNorth - startNorth;
    const squaredLength = deltaEast ** 2 + deltaNorth ** 2;
    if (squaredLength === 0) continue;
    const offsetEast = pointEast - startEast;
    const offsetNorth = pointNorth - startNorth;
    const fraction = clampedFraction((offsetEast * deltaEast + offsetNorth * deltaNorth) / squaredLength);
    const awayEast = offsetEast - fraction * deltaEast;
    const awayNorth = offsetNorth - fraction * deltaNorth;
    const crossFace = deltaEast * awayNorth - deltaNorth * awayEast;
    if (crossFace === 0) continue;
    const length = squaredLength ** 0.5;
    const faceSide = crossFace > 0 ? 1 : -1;
    const facingSun = faceSide * (deltaEast * sun[1] - deltaNorth * sun[0]) / length;
    const vote = length * facingSun;
    sideVote += vote;
    const distance = Math.hypot(awayEast, awayNorth);
    if (!nearest || distance < nearest.distance) nearest = {distance, vote};
  }
  const score = sideVote === 0 && nearest ? nearest.vote : sideVote;
  return score > 0 ? 'sunlit' : score < 0 ? 'shaded' : null;
}

// The latitude that sets the east-west metre scale for a green area, weighted by its shells minus its holes.
function greenMeanLatitude(geometry) {
  let totalArea = 0;
  let weightedLatitude = 0;
  for (const rings of polygonsOf(geometry)) {
    const ringMeasures = rings.map(ring => ({
      area: Math.abs(ringSignedAreaDegrees(ring)),
      centre: ringCentroid(ring)
    }));
    const [shell, ...holes] = ringMeasures;
    totalArea += shell.area;
    weightedLatitude += shell.area * shell.centre[1];
    for (const hole of holes) {
      totalArea -= hole.area;
      weightedLatitude -= hole.area * hole.centre[1];
    }
  }
  const allPoints = polygonsOf(geometry).flat(2);
  const mean = allPoints.reduce((sum, point) => sum + point[1], 0) / (allPoints.length || 1);
  return totalArea > areaTolerance ? weightedLatitude / totalArea : mean;
}

// Metres per degree east and north, from an explicit value or the area's mean latitude.
const scalesFor = (geometry, metresPerDegree) => metresPerDegree ?? [
  METRES_PER_DEGREE_LATITUDE * Math.cos(greenMeanLatitude(geometry) * Math.PI / 180),
  METRES_PER_DEGREE_LATITUDE
];

// The area of a face in whole square metres, with holes subtracted.
const faceAreaSquareMetres = (rings, scales) => {
  const signed = rings.reduce((area, ring, index) =>
    area + (index === 0 ? 1 : -1) * Math.abs(ringSignedAreaDegrees(ring)), 0);
  return Math.round(Math.abs(signed) * scales[0] * scales[1]);
};

// One green-area polygon cut by its ridges, in the shape the Python module returns.
export function splitFaces(greenArea, ridges, options = {}) {
  const scales = scalesFor(greenArea, options.metresPerDegree);
  const ridgeLines = ridges.flatMap(linesOf);
  const azimuthDegrees = options.azimuthDegrees ?? SUN_AZIMUTH_DEGREES;
  return polygonsOf(greenArea).flatMap(rings => {
    const areaBounds = ringBounds(rings[0]);
    const localRidges = ridgeLines.filter(line => boundsOverlap(areaBounds, lineBounds(line)));
    if (localRidges.length === 0) return [];
    const {nodes, edges} = graphOf(rings, localRidges);
    if (!edges.some(edge => edge.isRidgeHere)) return [];
    return facesFromCycles(cyclesOf(nodes, edges), rings).flatMap(ringsOfFace => {
      const point = representativePoint(ringsOfFace);
      if (!point || !pointInsidePolygon(point, rings)) return [];
      const boundarySegments = ridgeSegmentsOn(ringsOfFace, edges);
      const aspect = boundarySegments.length > 0
        ? faceAspect(point, boundarySegments, scales, azimuthDegrees)
        : null;
      const areaSquareMetres = faceAreaSquareMetres(ringsOfFace, scales);
      return [{aspect, geometry: {type: 'Polygon', coordinates: ringsOfFace}, areaSquareMetres}];
    });
  });
}

// The faces a map would publish from these sources. They are a preview, never edits of a source file.
export function slopeFaceFeatures(landFeatures, ridgeGeometries, options = {}) {
  const allowedKinds = options.greenKinds ?? greenKinds;
  return landFeatures
    .filter(feature => allowedKinds.has(feature.properties?.kind))
    .flatMap(feature => splitFaces(feature.geometry, ridgeGeometries, options)
      .filter(face => face.aspect !== null && face.areaSquareMetres >= MINIMUM_FACE_AREA_SQUARE_METRES)
      .map(face => ({
        type: 'Feature',
        properties: {kind: 'slope', aspect: face.aspect, areaSquareMetres: face.areaSquareMetres},
        geometry: face.geometry
      })));
}
