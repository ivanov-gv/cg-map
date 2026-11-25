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

const polygonHandles = (rings, polygonIndex) =>
  rings.flatMap((ring, ringIndex) =>
    ringCorners(ring).map((coordinate, vertexIndex) => ({
      ...(polygonIndex === undefined ? {} : {polygonIndex}),
      ringIndex,
      vertexIndex,
      coordinate
    }))
  );

// Every point the editor can grab. A closed ring's repeated last coordinate is not a separate handle.
export function vertexHandles(geometry) {
  if (geometry.type === 'Point') return [{vertexIndex: 0, coordinate: geometry.coordinates}];
  if (geometry.type === 'LineString') {
    return geometry.coordinates.map((coordinate, vertexIndex) => ({vertexIndex, coordinate}));
  }
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flatMap(polygonHandles);
  return polygonHandles(geometry.coordinates);
}

export const isSameHandle = (first, second) =>
  first?.polygonIndex === second?.polygonIndex &&
  first?.ringIndex === second?.ringIndex &&
  first?.vertexIndex === second?.vertexIndex;

const midpointOf = (start, end) => roundedCoordinate([(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]);

function sideHandles(handles, isClosed) {
  const sides = handles.map((handle, index) => [handle, handles[index + 1] ?? (isClosed ? handles[0] : null)]);
  return sides
    .filter(([, next]) => next)
    .map(([handle, next]) => ({
      ...handle,
      coordinate: midpointOf(handle.coordinate, next.coordinate),
      sideEnds: [handle.coordinate, next.coordinate],
      isMidpoint: true
    }));
}

// The middle of every side, where a new point can be added. Each is named by the point before it.
export function midpointHandles(geometry) {
  if (geometry.type === 'Point') return [];
  const handles = vertexHandles(geometry);
  if (geometry.type === 'LineString') return sideHandles(handles, false);
  const handlesByRing = Map.groupBy(handles, ({polygonIndex, ringIndex}) => `${polygonIndex ?? ''}/${ringIndex}`);
  return [...handlesByRing.values()].flatMap(ringHandles => sideHandles(ringHandles, true));
}

const withRing = (rings, ringIndex, changeVertices) =>
  rings.map((ring, index) => (index === ringIndex ? closeRing(changeVertices(ringCorners(ring))) : ring));

// Applies a change to the list of corners or line points a handle belongs to.
function withVertices(geometry, {polygonIndex, ringIndex}, changeVertices) {
  if (geometry.type === 'LineString') return {...geometry, coordinates: changeVertices(geometry.coordinates)};
  if (geometry.type === 'Polygon') {
    return {...geometry, coordinates: withRing(geometry.coordinates, ringIndex, changeVertices)};
  }
  const coordinates = geometry.coordinates.map((rings, index) =>
    index === polygonIndex ? withRing(rings, ringIndex, changeVertices) : rings
  );
  return {...geometry, coordinates};
}

export function moveVertex(geometry, handle, coordinate) {
  const rounded = roundedCoordinate(coordinate);
  if (geometry.type === 'Point') return {...geometry, coordinates: rounded};
  return withVertices(geometry, handle, vertices =>
    vertices.map((vertex, index) => (index === handle.vertexIndex ? rounded : vertex))
  );
}

// Inserts the midpoint of the edge after this vertex. A ring's last corner wraps to its first; a line's last
// point has no following edge, so the new point goes before it.
export function insertVertex(geometry, handle) {
  return withVertices(geometry, handle, vertices => {
    const isLastLinePoint = geometry.type === 'LineString' && handle.vertexIndex === vertices.length - 1;
    const startIndex = isLastLinePoint ? handle.vertexIndex - 1 : handle.vertexIndex;
    const end = vertices[(startIndex + 1) % vertices.length];
    return vertices.toSpliced(startIndex + 1, 0, midpointOf(vertices[startIndex], end));
  });
}

// The caller validates the result: too few remaining points is reported like any other invalid shape.
export function removeVertex(geometry, handle) {
  return withVertices(geometry, handle, vertices => vertices.toSpliced(handle.vertexIndex, 1));
}

// A shape with one more hole. The corners are in drawing order, open.
export function withHole(geometry, corners) {
  return {...geometry, coordinates: [...geometry.coordinates, closeRing(corners)]};
}

export function withoutHole(geometry, ringIndex) {
  return {...geometry, coordinates: geometry.coordinates.toSpliced(ringIndex, 1)};
}

export const polygonOfCorners = corners => ({type: 'Polygon', coordinates: [closeRing(corners)]});

// Moves every vertex by the same offset, which keeps a footprint's shape.
export function translateGeometry(geometry, longitudeOffset, latitudeOffset) {
  const shift = ([longitude, latitude]) => roundedCoordinate([longitude + longitudeOffset, latitude + latitudeOffset]);
  const shiftNested = coordinates =>
    typeof coordinates[0] === 'number' ? shift(coordinates) : coordinates.map(shiftNested);
  return {...geometry, coordinates: shiftNested(geometry.coordinates)};
}
