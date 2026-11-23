// Marks walking paths that run through green areas, so a map style can draw park routes differently from city
// footpaths. Derived when tiles are built, like municipality labels: roads.geojson stays an editable OSM source
// without a fact that would go stale after a land or road edit.

import {isInsideRing} from './ring-geometry.mjs';

const walkingKinds = new Set(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);

// Returns the bounding box [west, south, east, north] of a ring list.
function ringsBounds(rings) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [longitude, latitude] of ring) {
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    }
  }
  return [west, south, east, north];
}

// A point inside a hole lies inside two rings, outer and hole, and so counts as outside.
function isInsideRings(point, rings) {
  return rings.filter(ring => isInsideRing(point, ring)).length % 2 === 1;
}

function polygonRingLists(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// The point halfway along a line, in plain degrees: paths are short enough that the distortion does not matter here.
export function lineMiddle(coordinates) {
  const segmentLengths = coordinates.slice(1).map(([longitude, latitude], index) => {
    const [previousLongitude, previousLatitude] = coordinates[index];
    return Math.hypot(longitude - previousLongitude, latitude - previousLatitude);
  });
  let remaining = segmentLengths.reduce((total, length) => total + length, 0) / 2;
  for (const [index, length] of segmentLengths.entries()) {
    if (remaining <= length && length > 0) {
      const [startLongitude, startLatitude] = coordinates[index];
      const [endLongitude, endLatitude] = coordinates[index + 1];
      const fraction = remaining / length;
      return [startLongitude + fraction * (endLongitude - startLongitude), startLatitude + fraction * (endLatitude - startLatitude)];
    }
    remaining -= length;
  }
  return coordinates[0];
}

// Returns a test for road features: true for a walking path whose middle lies inside a green land polygon.
// greenKinds comes from the relief build parameters in provenance, the one list of green land kinds.
export function greenAreaTest(landFeatures, greenKinds) {
  const greenAreas = landFeatures
    .filter(feature => greenKinds.includes(feature.properties.kind))
    .flatMap(feature => polygonRingLists(feature.geometry))
    .map(rings => ({rings, bounds: ringsBounds(rings)}));
  return road => {
    const isWalkingLine = walkingKinds.has(road.properties.kind) && road.geometry.type === 'LineString';
    if (!isWalkingLine) return false;
    const middle = lineMiddle(road.geometry.coordinates);
    const [longitude, latitude] = middle;
    return greenAreas.some(({rings, bounds: [west, south, east, north]}) => {
      const isInBounds = longitude >= west && longitude <= east && latitude >= south && latitude <= north;
      return isInBounds && isInsideRings(middle, rings);
    });
  };
}
