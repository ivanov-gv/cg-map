// Label lines for named green areas: a park name reads along the long side of its hill (wiki UI 3.Core), and a
// MapLibre line label follows its line. Derived when tiles are built, from land.geojson and protected-areas.geojson,
// like municipality labels.

// The line covers this share of the area's long side, so a name centred on it stays inside the area.
const labelLineShare = 0.8;

// The z component of (first − origin) × (second − origin): positive when the three points turn counter-clockwise.
function crossProduct(origin, first, second) {
  return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
}

// Andrew's monotone chain: the convex hull, counter-clockwise, without a repeated first point.
function convexHull(points) {
  const sorted = [...points].sort(([firstX, firstY], [secondX, secondY]) => firstX - secondX || firstY - secondY);
  const lowerHull = [];
  for (const point of sorted) {
    while (lowerHull.length >= 2 && crossProduct(lowerHull.at(-2), lowerHull.at(-1), point) <= 0) lowerHull.pop();
    lowerHull.push(point);
  }
  const upperHull = [];
  for (const point of sorted.reverse()) {
    while (upperHull.length >= 2 && crossProduct(upperHull.at(-2), upperHull.at(-1), point) <= 0) upperHull.pop();
    upperHull.push(point);
  }
  return [...lowerHull.slice(0, -1), ...upperHull.slice(0, -1)];
}

// The smallest-area rectangle around the hull has one side on a hull edge; try each edge's direction.
function smallestRectangle(hull) {
  let best;
  for (const [index, start] of hull.entries()) {
    const end = hull[(index + 1) % hull.length];
    const edgeLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (edgeLength === 0) continue;
    const along = [(end[0] - start[0]) / edgeLength, (end[1] - start[1]) / edgeLength];
    const across = [-along[1], along[0]];
    const alongValues = hull.map(([x, y]) => x * along[0] + y * along[1]);
    const acrossValues = hull.map(([x, y]) => x * across[0] + y * across[1]);
    const alongRange = [Math.min(...alongValues), Math.max(...alongValues)];
    const acrossRange = [Math.min(...acrossValues), Math.max(...acrossValues)];
    const area = (alongRange[1] - alongRange[0]) * (acrossRange[1] - acrossRange[0]);
    if (!best || area < best.area) best = {area, along, across, alongRange, acrossRange};
  }
  return best;
}

// Works in metres around the area, so the long side is the long side on the ground, not in degrees.
export function longAxisLine(outerRing) {
  const [originLongitude, originLatitude] = outerRing[0];
  const metresPerDegreeLatitude = 111320;
  const metresPerDegreeLongitude = metresPerDegreeLatitude * Math.cos((originLatitude * Math.PI) / 180);
  const toMetres = ([longitude, latitude]) => [
    (longitude - originLongitude) * metresPerDegreeLongitude,
    (latitude - originLatitude) * metresPerDegreeLatitude
  ];
  const toDegrees = ([east, north]) => [
    originLongitude + east / metresPerDegreeLongitude,
    originLatitude + north / metresPerDegreeLatitude
  ];
  const hull = convexHull(outerRing.map(toMetres));
  if (hull.length < 3) return null;
  const rectangle = smallestRectangle(hull);
  const alongLength = rectangle.alongRange[1] - rectangle.alongRange[0];
  const acrossLength = rectangle.acrossRange[1] - rectangle.acrossRange[0];
  const isAlongLonger = alongLength >= acrossLength;
  const axis = isAlongLonger ? rectangle.along : rectangle.across;
  const axisRange = isAlongLonger ? rectangle.alongRange : rectangle.acrossRange;
  const otherAxis = isAlongLonger ? rectangle.across : rectangle.along;
  const otherRange = isAlongLonger ? rectangle.acrossRange : rectangle.alongRange;
  const centreAlong = (axisRange[0] + axisRange[1]) / 2;
  const centreAcross = (otherRange[0] + otherRange[1]) / 2;
  const halfLength = ((axisRange[1] - axisRange[0]) * labelLineShare) / 2;
  // Reading left to right: a line pointing west would put the name upside down without keep-upright.
  const direction = axis[0] < 0 ? [-axis[0], -axis[1]] : axis;
  const centre = [
    axis[0] * centreAlong + otherAxis[0] * centreAcross,
    axis[1] * centreAlong + otherAxis[1] * centreAcross
  ];
  const start = [centre[0] - direction[0] * halfLength, centre[1] - direction[1] * halfLength];
  const end = [centre[0] + direction[0] * halfLength, centre[1] + direction[1] * halfLength];
  return [toDegrees(start), toDegrees(end)];
}

function labelLines(feature) {
  const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
  return polygons
    .map(([outerRing]) => longAxisLine(outerRing))
    .filter(Boolean)
    .map(coordinates => ({
      type: 'Feature',
      geometry: {type: 'LineString', coordinates},
      properties: feature.properties
    }));
}

// One label line per named polygon part of a green kind (greenKinds is the relief build's reviewed list), and per named
// protected area. A park forest such as Park šuma Gorica is named only as a protected area over unnamed woods; a
// protected area whose name a green area already shows adds no second label.
export function greenAreaLabelLines(landFeatures, greenKinds, protectedAreas = []) {
  const namedGreenAreas = landFeatures.filter(feature => greenKinds.includes(feature.properties.kind) && feature.properties.name);
  const shownNames = new Set(namedGreenAreas.map(feature => feature.properties.name));
  const namedProtectedAreas = protectedAreas.filter(feature => !shownNames.has(feature.properties.name));
  return [...namedGreenAreas, ...namedProtectedAreas].flatMap(labelLines);
}
