// Facts that the published tiles add to the sources and the cartography reads, so that working copies look as they will
// once released.
import {coordinateAtOffset, metricOffset} from '../geometry/geometry-measures.js';
import {pointInsidePolygon} from '../geometry/geometry-validation.js';

const roadsFile = 'roads.geojson';
const landFile = 'land.geojson';
// As the tile builder reads them from the relief build (data/tools/green-areas.mjs): park paths are drawn differently.
const greenKinds = new Set([
  'park',
  'garden',
  'woods',
  'meadow',
  'grass',
  'scrub',
  'sports',
  'cemetery',
  'playground'
]);
const walkingKinds = new Set(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);

const polygonsOf = ({type, coordinates}) => ({Polygon: [coordinates], MultiPolygon: coordinates})[type] ?? [];

function boundsOfRing(ring) {
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

// The point halfway along a line.
export function lineMiddle(coordinates) {
  const lengths = coordinates.slice(1).map((end, index) => Math.hypot(...metricOffset(end, coordinates[index])));
  let remaining = lengths.reduce((total, length) => total + length, 0) / 2;
  for (const [index, length] of lengths.entries()) {
    if (length > 0 && remaining <= length) {
      const [east, north] = metricOffset(coordinates[index + 1], coordinates[index]);
      const fraction = remaining / length;
      return coordinateAtOffset([east * fraction, north * fraction], coordinates[index]);
    }
    remaining -= length;
  }
  return coordinates[0];
}

function greenAreasOf(landEntries) {
  return landEntries
    .filter(({feature}) => greenKinds.has(feature.properties.kind))
    .flatMap(({feature}) => polygonsOf(feature.geometry))
    .map(rings => ({rings, bounds: boundsOfRing(rings[0])}));
}

function isInGreenArea(feature, greenAreas) {
  const [longitude, latitude] = lineMiddle(feature.geometry.coordinates);
  return greenAreas.some(({rings, bounds: [west, south, east, north]}) => {
    const isNear = longitude >= west && longitude <= east && latitude >= south && latitude <= north;
    return isNear && pointInsidePolygon([longitude, latitude], rings);
  });
}

let latest = {landEntries: null, areas: [], byFeature: new WeakMap()};

function preparedFor(landEntries) {
  // The session keeps one list of entries until something changes in it.
  if (latest.landEntries !== landEntries) {
    latest = {landEntries, areas: greenAreasOf(landEntries), byFeature: new WeakMap()};
  }
  return latest;
}

// The derived facts of one object, to be drawn and never recorded.
export function derivedFacts({filename, feature}, entriesOf) {
  const isPath = filename === roadsFile && walkingKinds.has(feature.properties.kind);
  if (!isPath) return {};
  const {areas, byFeature} = preparedFor(entriesOf(landFile));
  if (!byFeature.has(feature)) byFeature.set(feature, isInGreenArea(feature, areas));
  return byFeature.get(feature) ? {inGreenArea: true} : {};
}
