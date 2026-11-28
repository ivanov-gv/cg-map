// Version 5 surface facts: a stored position stays stored, a shade stays inside the area its owner drew it in, a water
// area names a waterway in the same file, and every polygon holding a shared frame edge moves in one step.
import {
  isValidCoordinate,
  pointInsidePolygon,
  pointTouchesSegment,
  segmentsIntersect
} from '../../geometry/geometry-validation.js';
import {interiorPoint} from '../../geometry/interior-point.js';
import {changedStretch, followingEdits} from '../../geometry/shared-shapes.js';

export const greenAreaKinds = [
  'park', 'garden', 'woods', 'meadow', 'grass', 'scrub', 'sports', 'cemetery', 'playground'
];
export const frameKinds = ['municipality', 'context', 'sea'];
export const waterAreaKinds = ['lake', 'reservoir', 'pond', 'basin', 'water'];
export const waterLineKinds = ['river', 'stream', 'canal', 'ditch', 'drain'];
const surfaceFile = 'surface.geojson';
const storedPositionFields = ['labelPoint', 'labelLine', 'iconPoint'];
const sharedEdgeToleranceMetres = 1;

const polygonsOf = geometry => {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  return geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
};

const ringsOf = geometry => polygonsOf(geometry).flat();
const isAreaShape = geometry => ['Polygon', 'MultiPolygon'].includes(geometry?.type);
const isFrameKind = kind => frameKinds.includes(kind);
const isSamePoint = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const entryId = ({key, feature}) => feature.properties.entityId ?? key;
const segmentsOf = rings => rings.flatMap(ring => ring.slice(1).map((end, index) => [ring[index], end]));
const segmentKey = segment => segment.map(String).sort().join('|');
const keysOf = geometry => new Set(segmentsOf(ringsOf(geometry)).map(segmentKey));

const linkedEntry = (entries, entityId) =>
  entityId === undefined ? undefined : entries.find(entry => entryId(entry) === entityId);

// A corner can sit on a shared edge on one side and an exterior edge on the other. Matching each changed edge on its
// own finds the owner of that edge; matching one long run of corners can miss the neighbour entirely. When a vertex was
// added or removed there is no edge-by-edge pairing, so the stretch between the points that stayed is used instead.
function changedEdges(before, after) {
  if (before.length !== after.length) {
    const stretch = changedStretch(before, after);
    return stretch ? [stretch] : [];
  }
  return before.slice(1).flatMap((_, index) => {
    const beforeEdge = [before[index], before[index + 1]];
    const afterEdge = [after[index], after[index + 1]];
    return isSamePoint(beforeEdge, afterEdge) ? [] : [{before: beforeEdge, after: afterEdge}];
  });
}

function changedStretches(before, after) {
  const previous = ringsOf(before);
  const following = ringsOf(after);
  return previous.flatMap((ring, index) => changedEdges(ring, following[index] ?? ring));
}

function edgesByKey(entries) {
  const edges = new Map();
  for (const entry of entries.filter(({feature}) => isFrameKind(feature.properties.kind))) {
    for (const segment of segmentsOf(ringsOf(entry.feature.geometry))) {
      const key = segmentKey(segment);
      edges.set(key, [...(edges.get(key) ?? []), {entry, segment}]);
    }
  }
  return edges;
}

const sameOwners = (edges, key, owners) => {
  const found = (edges.get(key) ?? []).map(({entry}) => entry.key);
  return found.length === owners.length && owners.every(owner => found.includes(owner));
};

const crossProduct = (start, end, point) =>
  (end[0] - start[0]) * (point[1] - start[1]) - (end[1] - start[1]) * (point[0] - start[0]);

const isWholeSegment = ([firstStart, firstEnd], [secondStart, secondEnd]) =>
  pointTouchesSegment(firstStart, firstEnd, secondStart) &&
  pointTouchesSegment(firstStart, firstEnd, secondEnd) &&
  pointTouchesSegment(secondStart, secondEnd, firstStart) &&
  pointTouchesSegment(secondStart, secondEnd, firstEnd);

const isInteriorToSegment = (segment, point) =>
  pointTouchesSegment(...segment, point) && !segment.some(end => isSamePoint(end, point));

// Two frame edges may meet at a corner, but a crossing or a partly shared edge leaves an overlap or a gap.
function isAllowedEdgeContact(first, second) {
  if (isWholeSegment(first, second)) return true;
  const properCross =
    crossProduct(...first, second[0]) * crossProduct(...first, second[1]) < 0 &&
    crossProduct(...second, first[0]) * crossProduct(...second, first[1]) < 0;
  if (properCross) return false;
  const shareCorner = first.some(start => second.some(end => isSamePoint(start, end)));
  return shareCorner && ![...first, ...second].some((point, index) => isInteriorToSegment(index < 2 ? second : first, point));
}

function boundaryPoint(point, ring) {
  return ring.slice(1).some((end, index) => pointTouchesSegment(ring[index], end, point));
}

function pointInArea(point, polygons) {
  return polygons.some(rings => pointInsidePolygon(point, rings) || boundaryPoint(point, rings[0]));
}

// An edge may run along an outer boundary, but crossing or even following a hole takes it outside the green area.
function edgeStaysInside(start, end, polygons) {
  return polygons.every(rings => {
    const [outer, ...holes] = rings;
    const outerIsClear = outer.slice(1).every((second, index) => {
      const first = outer[index];
      return (
        !segmentsIntersect(start, end, first, second) ||
        (pointTouchesSegment(first, second, start) && pointTouchesSegment(first, second, end))
      );
    });
    const holesAreClear = holes.every(hole =>
      hole.slice(1).every((second, index) => !segmentsIntersect(start, end, hole[index], second))
    );
    return outerIsClear && holesAreClear;
  });
}

const isInsideFilled = (point, polygons) => polygons.some(rings => pointInsidePolygon(point, rings));

// Corners and edges alone do not see a shade drawn around a courtyard. Look inside the filled parts on both sides: a
// point of the parent hole inside the shade, or a point of the shade inside the hole, is a piece of the wrong surface.
function shadeCoversHole(shadePolygons, areaPolygons) {
  const holes = areaPolygons.flatMap(rings => rings.slice(1));
  const holeFilled =
    holes.some(hole => [interiorPoint([hole]), ...hole].some(point => isInsideFilled(point, shadePolygons)));
  return (
    holeFilled ||
    shadePolygons.some(rings => holes.some(hole => pointInsidePolygon(interiorPoint(rings), [hole])))
  );
}

function shadeStaysInside(feature, area) {
  const areaPolygons = polygonsOf(area.feature.geometry);
  const shadePolygons = polygonsOf(feature.geometry);
  if (shadePolygons.length === 0 || shadeCoversHole(shadePolygons, areaPolygons)) return false;
  return shadePolygons.every(rings =>
    rings.every(
      ring =>
        ring.every(point => pointInArea(point, areaPolygons)) &&
        ring.slice(1).every((end, index) => edgeStaysInside(ring[index], end, areaPolygons))
    )
  );
}

// A shade is optional, but once stored it belongs to exactly one green area and lies wholly inside it. The entries are
// the resulting file, so a moved or retyped area is judged with its shade still in place.
export function shadeProblem({key, feature}, context) {
  if (feature.properties.kind !== 'shade') return null;
  if (feature.geometry?.type !== 'MultiPolygon') return 'A shade needs a MultiPolygon area.';
  const entries = context.entriesOf(surfaceFile);
  const {greenAreaEntityId} = feature.properties;
  const area = linkedEntry(entries, greenAreaEntityId);
  if (!area || !greenAreaKinds.includes(area.feature.properties.kind)) {
    return 'A shade must name a green area in this file.';
  }
  const ownId = feature.properties.entityId ?? key;
  const hasOtherShade = entries.some(
    entry =>
      entryId(entry) !== ownId &&
      entry.feature.properties.kind === 'shade' &&
      entry.feature.properties.greenAreaEntityId === greenAreaEntityId
  );
  if (hasOtherShade) return 'This green area already has a shade.';
  return shadeStaysInside(feature, area) ? null : 'A shade must stay inside its green area.';
}

// The facts a new shade starts with. Its owner draws the shape; the editor never stores a scaled copy of the area.
export function shadeSeed(entry) {
  if (!greenAreaKinds.includes(entry.feature.properties.kind) || !isAreaShape(entry.feature.geometry)) return null;
  return {kind: 'shade', greenAreaEntityId: entryId(entry)};
}

// The card of a water area is the card of the waterway line it links to, never of another area.
export function linkedSelection(entry, context) {
  const {kind, riverEntityId} = entry.feature.properties;
  if (!waterAreaKinds.includes(kind) || riverEntityId === undefined) return entry;
  const river = linkedEntry(context.entriesOf(surfaceFile), riverEntityId);
  if (!river || !waterLineKinds.includes(river.feature.properties.kind)) return entry;
  return river.feature.geometry?.type === 'LineString' ? river : entry;
}

// Kind and geometry are one decision: a line cannot become a lake, and a frame kind cannot be invented by retyping.
export function surfaceKindProblem({feature, before}, context) {
  const {kind} = feature.properties;
  const shape = feature.geometry?.type;
  if (before && isFrameKind(before.properties.kind) !== isFrameKind(kind)) {
    return `${kind} cannot be changed from ${before.properties.kind}.`;
  }
  const expectsArea = isFrameKind(kind) || greenAreaKinds.includes(kind) || waterAreaKinds.includes(kind) ||
    kind === 'protected-area';
  if ((expectsArea || kind === 'shade') && !isAreaShape(feature.geometry)) return `${kind} needs an area.`;
  if (waterLineKinds.includes(kind) && shape !== 'LineString') return `${kind} needs a line.`;
  const {riverEntityId} = feature.properties;
  if (riverEntityId === undefined) return null;
  const river = linkedEntry(context.entriesOf(surfaceFile), riverEntityId);
  if (!waterAreaKinds.includes(kind) || !isAreaShape(feature.geometry)) return 'A river link belongs to a water area.';
  return river && waterLineKinds.includes(river.feature.properties.kind) && river.feature.geometry?.type === 'LineString'
    ? null
    : 'A river link must name a waterway in this file.';
}

function positionProblems(feature) {
  for (const field of storedPositionFields) {
    const value = feature.properties[field];
    if (value === undefined) continue;
    if (field === 'labelLine') {
      const distinct = Array.isArray(value) && new Set(value.map(String)).size === value.length;
      if (!Array.isArray(value) || value.length < 2 || !value.every(isValidCoordinate) || !distinct) {
        return 'labelLine needs at least two distinct WGS84 positions.';
      }
    } else if (!isValidCoordinate(value)) {
      return `${field} must be a WGS84 longitude and latitude.`;
    }
  }
  if (feature.properties.kind === 'lake' && feature.properties.iconPoint !== undefined) {
    if (!pointInArea(feature.properties.iconPoint, polygonsOf(feature.geometry))) {
      return 'A lake icon must stay inside its lake.';
    }
  }
  return null;
}

// Every edit path judges its own feature against the file it would leave behind.
export function surfaceEditProblem(change, context) {
  return surfaceKindProblem(change, context) ?? shadeProblem(change, context) ?? positionProblems(change.feature);
}

// The result of the pending edits, without recording them. An open edit is overlaid on what the session already holds.
export function resultingEntries(change, context, extraEdits = []) {
  const entries = new Map(
    context
      .entriesOf(surfaceFile)
      .filter(entry => entry.filename === surfaceFile)
      .map(entry => [entry.key, {...entry}])
  );
  for (const edit of [change, ...extraEdits]) {
    if (!edit || edit.filename && edit.filename !== surfaceFile) continue;
    if (edit.after === null) entries.delete(edit.key);
    else {
      entries.set(edit.key, {
        filename: surfaceFile,
        key: edit.key,
        // The edit carries the whole feature. Merging the old properties on top would keep a value it removed.
        feature: {...edit.after, properties: {...edit.after.properties}}
      });
    }
  }
  return [...entries.values()];
}

// An edge the reviewed source shared must stay shared by the same features. A one-sided move leaves a gap.
function hasBrokenBaseEdge(entries, baseEntries) {
  const baseEdges = edgesByKey(baseEntries);
  const resultEdges = edgesByKey(entries);
  const resultByKey = new Map(entries.map(entry => [entry.key, entry]));
  for (const [sharedKey, base] of baseEdges) {
    const owners = base.map(({entry}) => entry.key);
    if (owners.length < 2) continue;
    if (sameOwners(resultEdges, sharedKey, owners)) continue;
    const lostByOneOwner = owners.some(owner => (resultEdges.get(sharedKey) ?? []).some(({entry}) => entry.key === owner));
    if (lostByOneOwner) return true;
    const newKeysFor = owner =>
      [...keysOf(resultByKey.get(owner)?.feature.geometry)].filter(key => !baseEdges.has(key));
    const replacements = owners.map(newKeysFor);
    const common = replacements[0].filter(key =>
      replacements.slice(1).every(other => other.includes(key)) && sameOwners(resultEdges, key, owners)
    );
    if (common.length === 0) return true;
  }
  return false;
}

function hasPartialSharedEdge(entries) {
  const edges = [...edgesByKey(entries).values()].flat();
  for (const [index, first] of edges.entries()) {
    for (const second of edges.slice(index + 1)) {
      if (first.entry.key === second.entry.key) continue;
      if (!segmentsIntersect(...first.segment, ...second.segment)) continue;
      if (!isAllowedEdgeContact(first.segment, second.segment)) return true;
    }
  }
  return false;
}

const isStrictlyInside = (point, rings) =>
  pointInsidePolygon(point, rings) && !rings.some(ring => boundaryPoint(point, ring));

// Edge contacts cannot see a polygon moved wholly inside another one. Their filled areas must stay apart too.
function hasNestedFrame(entries) {
  const polygons = entries
    .filter(({feature}) => isFrameKind(feature.properties.kind))
    .flatMap(entry => polygonsOf(entry.feature.geometry).map(rings => ({key: entry.key, rings})));
  return polygons.some((first, index) =>
    polygons.slice(index + 1).some(second => {
      if (first.key === second.key) return false;
      const firstPoints = [interiorPoint(first.rings), ...first.rings.flat()];
      const secondPoints = [interiorPoint(second.rings), ...second.rings.flat()];
      return (
        firstPoints.some(point => isStrictlyInside(point, second.rings)) ||
        secondPoints.some(point => isStrictlyInside(point, first.rings))
      );
    })
  );
}

// The whole frame must come out of an edit without gaps, overlaps or one-sided moves.
export function frameTopologyProblem(entries, baseEntries = entries) {
  if (hasBrokenBaseEdge(entries, baseEntries)) return 'A shared frame edge was moved on only one side.';
  if (hasPartialSharedEdge(entries)) return 'Frame polygons overlap along part of an edge.';
  return hasNestedFrame(entries) ? 'Frame polygons overlap.' : null;
}

// Checks every feature of the resulting file, including links and uniqueness that one open edit cannot see alone.
export function surfaceResultProblem(entries, baseEntries = entries) {
  const context = {entriesOf: filename => (filename === surfaceFile ? entries : [])};
  const baseByKey = new Map(baseEntries.map(entry => [entry.key, entry]));
  for (const entry of entries) {
    const problem = surfaceEditProblem({...entry, before: baseByKey.get(entry.key)?.feature ?? null}, context);
    if (problem) return problem;
  }
  return frameTopologyProblem(entries, baseEntries);
}

// Apply, delete and import all use this: the file the step would leave, judged once against the reviewed source.
export function surfaceResultProblemForEdits(session, context, edits) {
  const surfaceEdits = edits.filter(({filename}) => filename === surfaceFile);
  if (surfaceEdits.length === 0) return null;
  const [change, ...extraEdits] = surfaceEdits;
  return surfaceResultProblem(resultingEntries(change, context, extraEdits), session.baseEntries(surfaceFile));
}

// Every outline that runs along a changed frame edge is spliced into the same changeset, including holes, neighbours
// and the sea. All rings are searched, not just municipality exteriors.
export function municipalityCompanions({key, feature, before}, context) {
  if (!before || !isFrameKind(feature.properties.kind)) return [];
  const stretches = changedStretches(before.geometry, feature.geometry);
  if (stretches.length === 0) return [];
  const neighbours = context
    .entriesOf(surfaceFile)
    .filter(entry => entry.key !== key && isFrameKind(entry.feature.properties.kind));
  const editsByKey = new Map();
  for (const stretch of stretches) {
    const candidates = neighbours.map(neighbour => ({
      filename: neighbour.filename,
      key: neighbour.key,
      feature: editsByKey.get(neighbour.key)?.after ?? neighbour.feature
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
        ? Array.isArray(value) && value.length >= 2 && value.every(isValidCoordinate)
          ? {type: 'LineString', coordinates: value}
          : null
        : isValidCoordinate(value)
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
