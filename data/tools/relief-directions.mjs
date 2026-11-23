// Checks the directions the relief contract promises: every canyon rim runs with its river on the right, and every
// contour with higher ground on the left. A style offsets canyon walls and turns contour heights by these directions,
// so a hand edit or a rebuild that reverses a line must fail validation, not draw a wall on the dry side.

const metresPerDegreeLatitude = 111320;

function metricScale(latitude) {
  return [metresPerDegreeLatitude * Math.cos((latitude * Math.PI) / 180), metresPerDegreeLatitude];
}

function crossProduct([firstEast, firstNorth], [secondEast, secondNorth]) {
  return firstEast * secondNorth - firstNorth * secondEast;
}

// The point of a segment closest to a point, all in degrees; short distances make the projection safe.
function closestPointOnSegment(point, start, end, [eastScale, northScale]) {
  const segment = [(end[0] - start[0]) * eastScale, (end[1] - start[1]) * northScale];
  const toPoint = [(point[0] - start[0]) * eastScale, (point[1] - start[1]) * northScale];
  const lengthSquared = segment[0] ** 2 + segment[1] ** 2;
  const share = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (toPoint[0] * segment[0] + toPoint[1] * segment[1]) / lengthSquared));
  return [start[0] + share * (end[0] - start[0]), start[1] + share * (end[1] - start[1])];
}

function closestRiverPoint(point, riverLines, scale) {
  let closest;
  let closestDistance = Infinity;
  for (const line of riverLines) {
    for (let index = 1; index < line.length; index++) {
      const candidate = closestPointOnSegment(point, line[index - 1], line[index], scale);
      const distance = Math.hypot((candidate[0] - point[0]) * scale[0], (candidate[1] - point[1]) * scale[1]);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }
  }
  return closest;
}

// Judged at the rim's middle segment against the closest point of its river's centrelines, as the builder orients it.
function hasRiverOnRight(rim, riverLines) {
  const coordinates = rim.geometry.coordinates;
  const middleIndex = Math.max(1, Math.floor(coordinates.length / 2));
  const start = coordinates[middleIndex - 1];
  const end = coordinates[middleIndex];
  const middle = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const scale = metricScale(middle[1]);
  const river = closestRiverPoint(middle, riverLines, scale);
  const direction = [(end[0] - start[0]) * scale[0], (end[1] - start[1]) * scale[1]];
  const toRiver = [(river[0] - middle[0]) * scale[0], (river[1] - middle[1]) * scale[1]];
  return crossProduct(direction, toRiver) < 0;
}

function signedRingArea(ring) {
  let doubledArea = 0;
  for (let index = 1; index < ring.length; index++) {
    doubledArea += crossProduct(ring[index - 1], ring[index]);
  }
  return doubledArea / 2;
}

// Even-odd ray casting in degrees.
function isInsideRing([longitude, latitude], ring) {
  let isInside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [startLongitude, startLatitude] = ring[previous];
    const [endLongitude, endLatitude] = ring[index];
    const crossesLatitude = (startLatitude > latitude) !== (endLatitude > latitude);
    if (!crossesLatitude) continue;
    const crossingLongitude =
      startLongitude + ((latitude - startLatitude) / (endLatitude - startLatitude)) * (endLongitude - startLongitude);
    if (longitude < crossingLongitude) isInside = !isInside;
  }
  return isInside;
}

// Returns the rims whose river lies on their left, judged against the named river's centrelines in water.geojson.
export function reversedCanyonRims(canyonRims, water) {
  const riverLines = new Map();
  for (const feature of water.features) {
    const isCentreline = feature.geometry.type === 'LineString' && feature.properties.kind !== 'coastline';
    if (!isCentreline || !feature.properties.name) continue;
    const lines = riverLines.get(feature.properties.name) ?? [];
    lines.push(feature.geometry.coordinates);
    riverLines.set(feature.properties.name, lines);
  }
  return canyonRims.features.filter(rim => {
    const lines = riverLines.get(rim.properties.river);
    if (!lines) return true;
    return !hasRiverOnRight(rim, lines);
  });
}

// A summit's enclosingContourElevation names the closest closed contour around it, so the ground just inside that
// ring rises toward the summit: with higher ground on the left, the ring runs counter-clockwise. Returns the rings
// that run the other way and how many rings were checked.
export function reversedSummitContours(contours, summits) {
  const rings = contours.features.filter(feature => {
    const coordinates = feature.geometry.coordinates;
    const [firstLongitude, firstLatitude] = coordinates[0];
    const [lastLongitude, lastLatitude] = coordinates.at(-1);
    return firstLongitude === lastLongitude && firstLatitude === lastLatitude;
  });
  const checked = new Set();
  for (const summit of summits.features) {
    const elevation = summit.properties.enclosingContourElevation;
    if (!Number.isFinite(elevation)) continue;
    const enclosing = rings.filter(ring =>
      ring.properties.elevation === elevation && isInsideRing(summit.geometry.coordinates, ring.geometry.coordinates)
    );
    for (const ring of enclosing) checked.add(ring);
  }
  const reversed = [...checked].filter(ring => signedRingArea(ring.geometry.coordinates) <= 0);
  return {reversed, checkedCount: checked.size};
}
