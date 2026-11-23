// Plane geometry on WGS84 rings in degrees, shared by the tile builder's derived layers and the relief checks.
// Areas are small enough that treating degrees as plane coordinates never changes an inside/outside answer here.

// Even-odd ray casting: true when the point lies inside the closed ring.
export function isInsideRing([longitude, latitude], ring) {
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
