// Pure geometry edits. Each returns a new geometry and keeps a polygon ring closed, so no caller can
// forget to move the closing coordinate together with the first corner.

// Seven decimals is about a centimetre, finer than any source coordinate, and avoids noisy diffs.
const coordinateDecimals = 7;

export function roundedCoordinate([longitude, latitude]) {
  const scale = 10 ** coordinateDecimals;
  return [Math.round(longitude * scale) / scale, Math.round(latitude * scale) / scale];
}

// Removing the last corner leaves an empty ring, which validation reports like any other invalid shape.
const closeRing = corners => (corners.length > 0 ? [...corners, [...corners[0]]] : []);
const ringCorners = ring => ring.slice(0, -1);

// Every point the editor can grab. A closed ring's repeated last coordinate is not a separate handle.
export function vertexHandles(geometry) {
  if (geometry.type === 'Point') return [{vertexIndex: 0, coordinate: geometry.coordinates}];
  if (geometry.type === 'LineString') {
    return geometry.coordinates.map((coordinate, vertexIndex) => ({vertexIndex, coordinate}));
  }
  return geometry.coordinates.flatMap((ring, ringIndex) =>
    ringCorners(ring).map((coordinate, vertexIndex) => ({ringIndex, vertexIndex, coordinate}))
  );
}

// Applies a change to the list of corners or line points a handle belongs to.
function withVertices(geometry, ringIndex, changeVertices) {
  if (geometry.type === 'LineString') return {...geometry, coordinates: changeVertices(geometry.coordinates)};
  const coordinates = geometry.coordinates.map((ring, index) =>
    index === ringIndex ? closeRing(changeVertices(ringCorners(ring))) : ring
  );
  return {...geometry, coordinates};
}

export function moveVertex(geometry, {ringIndex, vertexIndex}, coordinate) {
  const rounded = roundedCoordinate(coordinate);
  if (geometry.type === 'Point') return {...geometry, coordinates: rounded};
  return withVertices(geometry, ringIndex, vertices =>
    vertices.map((vertex, index) => (index === vertexIndex ? rounded : vertex))
  );
}

// Inserts the midpoint of the edge after this vertex. A ring's last corner wraps to its first; a line's last
// point has no following edge, so the new point goes before it.
export function insertVertex(geometry, {ringIndex, vertexIndex}) {
  return withVertices(geometry, ringIndex, vertices => {
    const isLastLinePoint = geometry.type === 'LineString' && vertexIndex === vertices.length - 1;
    const startIndex = isLastLinePoint ? vertexIndex - 1 : vertexIndex;
    const start = vertices[startIndex];
    const end = vertices[(startIndex + 1) % vertices.length];
    const midpoint = roundedCoordinate([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);
    return vertices.toSpliced(startIndex + 1, 0, midpoint);
  });
}

// The caller validates the result: too few remaining points is reported like any other invalid shape.
export function removeVertex(geometry, {ringIndex, vertexIndex}) {
  return withVertices(geometry, ringIndex, vertices => vertices.toSpliced(vertexIndex, 1));
}

export function appendLinePoint(geometry, coordinate) {
  return {...geometry, coordinates: [...geometry.coordinates, roundedCoordinate(coordinate)]};
}

// Moves every vertex by the same offset, which keeps a footprint's shape.
export function translateGeometry(geometry, longitudeOffset, latitudeOffset) {
  const shift = ([longitude, latitude]) => roundedCoordinate([longitude + longitudeOffset, latitude + latitudeOffset]);
  if (geometry.type === 'Point') return {...geometry, coordinates: shift(geometry.coordinates)};
  if (geometry.type === 'LineString') return {...geometry, coordinates: geometry.coordinates.map(shift)};
  return {...geometry, coordinates: geometry.coordinates.map(ring => ring.map(shift))};
}
