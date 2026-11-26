// Lengths and areas someone reads while drawing. A local plane around the shape is precise enough at city scale.
const metresPerDegreeLatitude = 111320;
const squareMetresPerHectare = 10000;
const metresPerKilometre = 1000;

// Metres east and north of an origin.
export function metricOffset(coordinate, origin) {
  const eastScale = metresPerDegreeLatitude * Math.cos((origin[1] * Math.PI) / 180);
  return [(coordinate[0] - origin[0]) * eastScale, (coordinate[1] - origin[1]) * metresPerDegreeLatitude];
}

// The coordinate this many metres east and north of an origin.
export function coordinateAtOffset([east, north], origin) {
  const eastScale = metresPerDegreeLatitude * Math.cos((origin[1] * Math.PI) / 180);
  return [origin[0] + east / eastScale, origin[1] + north / metresPerDegreeLatitude];
}

export function distanceMetres(first, second) {
  return Math.hypot(...metricOffset(second, first));
}

export function lineLengthMetres(coordinates) {
  return coordinates.slice(1).reduce((length, end, index) => length + distanceMetres(coordinates[index], end), 0);
}

// The point of a segment nearest to a coordinate, in degrees; a local plane is precise enough at city scale.
export function nearestPointOnSegment(coordinate, start, end) {
  const side = metricOffset(end, start);
  const offset = metricOffset(coordinate, start);
  const squaredLength = side[0] ** 2 + side[1] ** 2;
  const projection = squaredLength === 0 ? 0 : (offset[0] * side[0] + offset[1] * side[1]) / squaredLength;
  const fraction = Math.max(0, Math.min(1, projection));
  return [start[0] + fraction * (end[0] - start[0]), start[1] + fraction * (end[1] - start[1])];
}

// The nearest point of a line: {coordinate, segmentIndex, distanceMetres}.
export function nearestPointOnLine(coordinate, line) {
  let nearest = {coordinate: line[0], segmentIndex: 0, distanceMetres: Infinity};
  for (let segmentIndex = 0; segmentIndex < line.length - 1; segmentIndex += 1) {
    const candidate = nearestPointOnSegment(coordinate, line[segmentIndex], line[segmentIndex + 1]);
    const candidateDistance = distanceMetres(candidate, coordinate);
    if (candidateDistance < nearest.distanceMetres) {
      nearest = {coordinate: candidate, segmentIndex, distanceMetres: candidateDistance};
    }
  }
  return nearest;
}

// The nearest point of a shape's outline or of one of its holes.
export function nearestPointOnOutline(coordinate, rings) {
  const candidates = rings.map(ring => nearestPointOnLine(coordinate, ring));
  return candidates.reduce((nearest, candidate) =>
    candidate.distanceMetres < nearest.distanceMetres ? candidate : nearest
  );
}

// Works for an open list of corners and for a closed ring.
export function ringAreaSquareMetres(corners) {
  const points = corners.map(corner => metricOffset(corner, corners[0]));
  const twiceArea = points.reduce((area, point, index) => {
    const next = points[(index + 1) % points.length];
    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  return Math.abs(twiceArea) / 2;
}

export function polygonAreaSquareMetres([outerRing, ...holes]) {
  return holes.reduce((area, hole) => area - ringAreaSquareMetres(hole), ringAreaSquareMetres(outerRing));
}

export function geometryAreaSquareMetres(geometry) {
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polygons.reduce((area, rings) => area + polygonAreaSquareMetres(rings), 0);
}

export function formatLength(metres) {
  if (metres >= metresPerKilometre) return `${(metres / metresPerKilometre).toFixed(1)} km`;
  return metres >= 10 ? `${Math.round(metres)} m` : `${metres.toFixed(1)} m`;
}

export function formatArea(squareMetres) {
  if (squareMetres >= squareMetresPerHectare) return `${(squareMetres / squareMetresPerHectare).toFixed(1)} ha`;
  return `${Math.round(squareMetres)} m²`;
}

// The corner nearest to a coordinate that keeps a right angle with the side before it, or continues that side straight.
export function rightAngledCorner(corners, coordinate) {
  if (corners.length < 2) return coordinate;
  const [start, end] = corners.slice(-2);
  const side = metricOffset(end, start);
  const sideLength = Math.hypot(...side);
  if (sideLength === 0) return coordinate;
  const along = [side[0] / sideLength, side[1] / sideLength];
  const across = [-along[1], along[0]];
  const offset = metricOffset(coordinate, end);
  const alongLength = offset[0] * along[0] + offset[1] * along[1];
  const acrossLength = offset[0] * across[0] + offset[1] * across[1];
  const isTurning = Math.abs(acrossLength) >= Math.abs(alongLength);
  const [direction, length] = isTurning ? [across, acrossLength] : [along, alongLength];
  return coordinateAtOffset([direction[0] * length, direction[1] * length], end);
}
