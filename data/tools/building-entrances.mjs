const DEGREES_TO_RADIANS = Math.PI / 180;

// Mercator offsets match the map's plane, so the wall normal stays perpendicular when the camera rotates.
function projectedOffset(coordinates, origin) {
  const northing = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * DEGREES_TO_RADIANS / 2));
  return [
    (coordinates[0] - origin[0]) * DEGREES_TO_RADIANS,
    northing(coordinates[1]) - northing(origin[1])
  ];
}

// Return the clockwise bearing from north of the nearest wall's inward normal. Holes invert the building side.
export function entranceBearing(coordinates, polygon) {
  let closestWall = null;
  for (const [ringIndex, ring] of polygon.coordinates.entries()) {
    const vertices = ring.map(vertex => projectedOffset(vertex, coordinates));
    const signedArea = vertices.slice(1).reduce((area, end, index) => {
      const start = vertices[index];
      return area + start[0] * end[1] - end[0] * start[1];
    }, 0);
    if (!Number.isFinite(signedArea) || signedArea === 0) throw new Error('Entrance footprint has a degenerate ring');
    const inwardSign = Math.sign(signedArea) * (ringIndex === 0 ? 1 : -1);
    for (let index = 1; index < vertices.length; index++) {
      const start = vertices[index - 1];
      const end = vertices[index];
      const east = end[0] - start[0];
      const north = end[1] - start[1];
      const squaredLength = east * east + north * north;
      if (squaredLength === 0) continue;
      const fraction = Math.max(0, Math.min(1, -(start[0] * east + start[1] * north) / squaredLength));
      const distance = Math.hypot(start[0] + fraction * east, start[1] + fraction * north);
      if (closestWall && distance >= closestWall.distance) continue;
      closestWall = {distance, inwardEast: -north * inwardSign, inwardNorth: east * inwardSign};
    }
  }
  if (!closestWall) throw new Error('Entrance footprint has no wall');
  const bearing = Math.atan2(closestWall.inwardEast, closestWall.inwardNorth) / DEGREES_TO_RADIANS;
  return (bearing + 360) % 360;
}
