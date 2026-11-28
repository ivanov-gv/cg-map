// Version 5 surface facts: a stored position stays stored, a shade stays inside its own green area, a water area opens
// the river card, and a shared municipal edge moves every polygon that holds it in one step.
import {pointInsidePolygon} from '../../geometry/geometry-validation.js';
import {interiorPoint} from '../../geometry/interior-point.js';
import {changedStretch, followingEdits} from '../../geometry/shared-shapes.js';

export const greenAreaKinds = [
  'park', 'garden', 'woods', 'meadow', 'grass', 'scrub', 'sports', 'cemetery', 'playground'
];
const waterLineKinds = ['river', 'stream', 'canal', 'ditch', 'drain'];
const surfaceFile = 'surface.geojson';
const storedPositionFields = ['labelPoint', 'labelLine', 'iconPoint'];
const sharedEdgeToleranceMetres = 1;

const isCoordinatePair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

const polygonsOf = geometry => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
};

// One exterior ring per polygon, so a MultiPolygon municipality can share more than one border.
const outerRingsOf = geometry =>
  polygonsOf(geometry)
    .map(rings => rings[0])
    .filter(Boolean);

function changedStretches(before, after) {
  const previous = outerRingsOf(before);
  return previous.flatMap((ring, index) => {
    const stretch = changedStretch(ring, outerRingsOf(after)[index] ?? ring);
    return stretch ? [stretch] : [];
  });
}

const entryId = ({key, feature}) => feature.properties.entityId ?? key;

const linkedEntry = (entries, entityId) =>
  entityId === undefined ? undefined : entries.find(entry => entryId(entry) === entityId);

const isInsideAnyPolygon = (point, polygons) =>
  polygons.some(rings => pointInsidePolygon(point, rings));

// A shade is optional, but once stored it belongs to exactly one green area and lies wholly inside it.
export function shadeProblem({key, feature}, context) {
  if (feature.properties.kind !== 'shade') return null;
  if (feature.geometry?.type !== 'MultiPolygon') return 'A shade must be a MultiPolygon.';
  const {greenAreaEntityId} = feature.properties;
  const entries = context.entriesOf(surfaceFile);
  const area = linkedEntry(entries, greenAreaEntityId);
  if (!area || !greenAreaKinds.includes(area.feature.properties.kind)) {
    return 'A shade must name a green area in this file.';
  }
  const hasOtherShade = entries.some(
    entry =>
      entry.key !== key &&
      entry.feature.properties.kind === 'shade' &&
      entry.feature.properties.greenAreaEntityId === greenAreaEntityId
  );
  if (hasOtherShade) return 'This green area already has a shade.';
  const areaPolygons = polygonsOf(area.feature.geometry);
  const isOutside = polygonsOf(feature.geometry).some(polygon =>
    polygon.some(ring => ring.some(point => !isInsideAnyPolygon(point, areaPolygons)))
  );
  return isOutside ? 'A shade must stay inside its green area.' : null;
}

// A new shade is seeded well inside the picked area, so the first Apply is valid and its shape can then be edited.
export function shadeForArea(entry) {
  const {feature} = entry;
  if (!greenAreaKinds.includes(feature.properties.kind)) return null;
  const polygons = polygonsOf(feature.geometry).filter(rings => rings.length > 0);
  if (polygons.length === 0) return null;
  const rings = polygons[0];
  const centre = interiorPoint(rings);
  const insideRings = rings.map(ring =>
    ring.map(point => point.map((value, axis) => centre[axis] + (value - centre[axis]) * 0.5))
  );
  if (!insideRings.every(ring => ring.every(point => pointInsidePolygon(point, rings)))) return null;
  return {
    type: 'Feature',
    properties: {kind: 'shade', greenAreaEntityId: entryId(entry)},
    geometry: {type: 'MultiPolygon', coordinates: [insideRings]}
  };
}

// The card of a water area is the card of the river line it links to.
export function linkedSelection(entry, context) {
  const {kind, riverEntityId} = entry.feature.properties;
  if (!['lake', 'reservoir', 'pond', 'basin', 'water'].includes(kind) || riverEntityId === undefined) return entry;
  const river = linkedEntry(context.entriesOf(surfaceFile), riverEntityId);
  return river && waterLineKinds.includes(river.feature.properties.kind) ? river : entry;
}

// Every outline that runs along a changed municipal edge is spliced into the same changeset.
export function municipalityCompanions({key, feature, before}, context) {
  if (!before || feature.properties.kind !== 'municipality') return [];
  const stretches = changedStretches(before.geometry, feature.geometry);
  if (stretches.length === 0) return [];
  const neighbours = context
    .entriesOf(surfaceFile)
    .filter(entry => entry.key !== key && entry.feature.properties.kind === 'municipality');
  const editsByKey = new Map();
  for (const stretch of stretches) {
    const candidates = neighbours.map(({filename, key: neighbourKey, feature: neighbour}) => ({
      filename,
      key: neighbourKey,
      feature: editsByKey.get(neighbourKey)?.after ?? neighbour
    }));
    for (const edit of followingEdits(candidates, stretch, sharedEdgeToleranceMetres)) {
      editsByKey.set(edit.key, edit);
    }
  }
  return [...editsByKey.values()];
}

// The displayed copies carry no computed position. They are made only from fields the source already stores.
export function storedPositionFeatures(entries) {
  return entries.flatMap(({filename, key, feature}) =>
    storedPositionFields.flatMap(field => {
      const value = feature.properties[field];
      const geometry = field === 'labelLine'
        ? Array.isArray(value) && value.length > 0 && value.every(isCoordinatePair)
          ? {type: 'LineString', coordinates: value}
          : null
        : isCoordinatePair(value)
          ? {type: 'Point', coordinates: value}
          : null;
      return geometry ? [{type: 'Feature', properties: {field, key, sourceFile: filename}, geometry}] : [];
    })
  );
}

// Moving a stored line shifts its own points; it never takes them from the outline of the object it labels.
export function movedStoredValue(field, value, coordinate) {
  if (field !== 'labelLine' || !Array.isArray(value) || value.length === 0) return coordinate;
  const centre = [0, 1].map(axis => value.reduce((sum, point) => sum + point[axis], 0) / value.length);
  return value.map(point => point.map((valueAtAxis, axis) => valueAtAxis + coordinate[axis] - centre[axis]));
}
