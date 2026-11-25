// Where rivers meet rivers and water areas. A join is kept when either side moves.
import {roundedCoordinate} from './geometry-editing.js';
import {distanceMetres, nearestPointOnLine, nearestPointOnOutline} from './geometry-measures.js';
import {isInside} from './interior-point.js';
import {movedPoints, originsAfter, startingOrigins} from './line-origins.js';
import {boundsOf, entriesNear, entriesWithin, isWithin, pointKey, unjoinedCrossings} from './road-graph.js';
import {endsOf, isSamePoint, withJunctionAt} from './road-shapes.js';

// Source lines end on an outline up to rounding and simplification.
const joinToleranceMetres = 1;
// An end this close to other water was probably meant to join it.
const nearMissMetres = 5;
// A point put on another line lies on it up to rounding.
const touchMetres = 0.2;

const isLine = ({feature}) => feature.geometry.type === 'LineString';
const isCoastline = entry => isLine(entry) && entry.feature.properties.kind === 'coastline';

// Lines that water flows along. The coastline is the edge of the sea.
export const isWaterway = entry => isLine(entry) && !isCoastline(entry);

// What a waterway ends on: the outline of a water area, or the coastline. The shape of the sea is simpler than that.
const isShore = entry => entry.feature.geometry.type === 'Polygon' || isCoastline(entry);

const outlinesOf = ({type, coordinates}) => (type === 'LineString' ? [coordinates] : coordinates);
const polygonsOf = ({type, coordinates}) => (type === 'MultiPolygon' ? coordinates : [coordinates]);

const isOnOutline = (point, outlines) => nearestPointOnOutline(point, outlines).distanceMetres <= joinToleranceMetres;
const onOutline = (point, outlines) => roundedCoordinate(nearestPointOnOutline(point, outlines).coordinate);

const isOnShore = (point, entry) => isShore(entry) && isOnOutline(point, outlinesOf(entry.feature.geometry));

// Whether a point is on a shore or in the water of an area. Rivers drawn as areas have their lines inside.
function isInWater(point, entry) {
  if (isOnShore(point, entry)) return true;
  const isArea = !isLine(entry);
  return isArea && polygonsOf(entry.feature.geometry).some(rings => isInside(point, rings));
}

const withCoordinates = (feature, coordinates) => ({...feature, geometry: {...feature.geometry, coordinates}});

// The edit of an entry with other coordinates, or none when they are the same.
function editsOf({filename, key, feature}, coordinates) {
  const isChanged = coordinates.some((point, index) => point !== feature.geometry.coordinates[index]);
  return isChanged ? [{filename, key, after: withCoordinates(feature, coordinates)}] : [];
}

function nearestOf(points, coordinate) {
  return points.reduce((nearest, point) =>
    distanceMetres(point, coordinate) < distanceMetres(nearest, coordinate) ? point : nearest
  );
}

// Where every point that a line no longer has went: one that was moved to its new place, one that was taken out to the
// nearest point left, because water that flowed there still flows into this line.
function joinMoves(before, after, origins = originsAfter(before.coordinates, startingOrigins(before), after.coordinates)) {
  const moved = movedPoints(before, after, origins).map(({from, to}) => ({from, to}));
  const taken = before.coordinates.filter(
    (point, index) => !origins.includes(index) && !after.coordinates.some(other => isSamePoint(other, point))
  );
  return [...moved, ...taken.map(from => ({from, to: nearestOf(after.coordinates, from)}))];
}

// Other lines that share a moved point go with it.
export function linesKeepingJoins(key, before, after, waterEntries, {origins, freePoints = new Set()} = {}) {
  const moves = joinMoves(before, after, origins).filter(({from}) => !freePoints.has(pointKey(from)));
  if (moves.length === 0) return [];
  const otherLines = waterEntries.filter(entry => isLine(entry) && entry.key !== key);
  return otherLines.flatMap(entry => {
    const {coordinates} = entry.feature.geometry;
    return editsOf(entry, coordinates.map(point => moves.find(({from}) => isSamePoint(from, point))?.to ?? point));
  });
}

// Waterways that ended on a shore still end on it after it moved.
export function riversKeepingShore(before, after, waterEntries) {
  const waterways = waterEntries.filter(isWaterway);
  return waterways.flatMap(entry => {
    const {coordinates} = entry.feature.geometry;
    const kept = end => {
      const isLeft = isOnOutline(end, outlinesOf(before)) && !isOnOutline(end, outlinesOf(after));
      return isLeft ? onOutline(end, outlinesOf(after)) : end;
    };
    return editsOf(entry, [kept(coordinates[0]), ...coordinates.slice(1, -1), kept(coordinates.at(-1))]);
  });
}

// Where an end of a line was before: the end it comes from, or null for a point that became an end since. Without known
// origins an end that cannot be told is compared with the end on its side.
function previousEnd(index, before, after, origins) {
  const origin = (origins ?? originsAfter(before.coordinates, startingOrigins(before), after.coordinates)).at(index);
  if (!origins && origin === null) return before.coordinates.at(index);
  const isEnd = origin === 0 || origin === before.coordinates.length - 1;
  return isEnd ? before.coordinates[origin] : null;
}

// A waterway whose end was on a shore ends on that shore wherever it is dragged, unless it was disconnected.
export function riverEndingOnShores(before, after, waterEntries, {origins, freePoints = new Set()} = {}) {
  if (!before) return after;
  const shores = waterEntries.filter(isShore);
  const endOnItsShore = index => {
    const end = after.coordinates.at(index);
    const previous = previousEnd(index, before, after, origins);
    const isMoved = previous && !isSamePoint(previous, end) && !freePoints.has(pointKey(previous));
    const shore = isMoved && entriesNear(previous, shores).find(entry => isOnShore(previous, entry));
    return shore ? onOutline(end, outlinesOf(shore.feature.geometry)) : end;
  };
  return {...after, coordinates: [endOnItsShore(0), ...after.coordinates.slice(1, -1), endOnItsShore(-1)]};
}

// What a river flows into at its last point: another line that has the point, or water it ends in.
export function flowsInto({key, feature}, waterEntries) {
  const [, mouth] = endsOf(feature);
  const others = entriesNear(mouth, waterEntries).filter(entry => entry.key !== key);
  const line = others.find(
    entry => isWaterway(entry) && entry.feature.geometry.coordinates.some(point => isSamePoint(point, mouth))
  );
  return line ?? others.find(entry => isInWater(mouth, entry));
}

// Other lines get a point where a drawn or reshaped one now touches them.
export function linesTouched(key, before, after, waterEntries) {
  const known = new Set((before?.coordinates ?? []).map(pointKey));
  const newPoints = after.coordinates.filter(point => !known.has(pointKey(point)));
  return waterEntries.filter(entry => isWaterway(entry) && entry.key !== key).flatMap(({filename, key: otherKey, feature}) => {
    const joined = newPoints.reduce((line, point) => withJunctionAt(line, point, touchMetres) ?? line, feature);
    return joined === feature ? [] : [{filename, key: otherKey, after: joined}];
  });
}

const isNear = (point, {feature}) => nearestPointOnOutline(point, outlinesOf(feature.geometry)).distanceMetres <= nearMissMetres;

// What the end of a line alone at its point is: in other water it joins that, beside other water it nearly does.
function statusOfLooseEnd(coordinate, key, entries) {
  const others = entriesNear(coordinate, entries).filter(entry => entry.key !== key);
  if (others.some(entry => isInWater(coordinate, entry))) return 'joined';
  return others.some(entry => (isWaterway(entry) || isShore(entry)) && isNear(coordinate, entry)) ? 'near' : 'deadEnd';
}

// Every joint of the waterways in a view, as the road graph has them: [{coordinate, status}].
export function waterJointsIn(bounds, allEntries) {
  const entries = entriesWithin(allEntries, bounds);
  const waterways = entries.filter(isWaterway);
  const linesByPoint = new Map();
  for (const entry of waterways) {
    const {coordinates} = entry.feature.geometry;
    coordinates.forEach((coordinate, index) => {
      const isEnd = index === 0 || index === coordinates.length - 1;
      const key = pointKey(coordinate);
      if (!linesByPoint.has(key)) linesByPoint.set(key, []);
      linesByPoint.get(key).push({coordinate, entry, isEnd});
    });
  }
  const joints = [...linesByPoint.values()].flatMap(members => {
    const [{coordinate, entry, isEnd}] = members;
    if (!isWithin(coordinate, bounds)) return [];
    if (members.length > 1) return [{coordinate, status: 'joined'}];
    return isEnd ? [{coordinate, status: statusOfLooseEnd(coordinate, entry.key, allEntries)}] : [];
  });
  return [...joints, ...unjoinedCrossings(waterways).filter(({coordinate}) => isWithin(coordinate, bounds))];
}

// The points of a waterway that others share, and the ends of it that lie on a shore.
export function joinedWaterPoints({key, feature}, waterEntries) {
  if (feature.geometry.type !== 'LineString') return [];
  const others = entriesWithin(waterEntries, boundsOf(feature)).filter(entry => entry.key !== key);
  const otherPoints = new Set(others.filter(isWaterway).flatMap(entry => entry.feature.geometry.coordinates.map(pointKey)));
  const {coordinates} = feature.geometry;
  return coordinates.filter((point, index) => {
    if (otherPoints.has(pointKey(point))) return true;
    const isEnd = index === 0 || index === coordinates.length - 1;
    return isEnd && others.some(entry => isOnShore(point, entry));
  });
}

// The nearest place of every other waterway, and of every shore for an end.
export function joinableWater(coordinate, waterEntries, ignoredKeys, isEnd) {
  const lines = waterEntries.filter(entry => isWaterway(entry) && !ignoredKeys.has(entry.key));
  const shores = isEnd ? waterEntries.filter(isShore) : [];
  return [
    ...lines.map(({feature}) => ({...nearestPointOnLine(coordinate, feature.geometry.coordinates), points: feature.geometry.coordinates})),
    ...shores.map(({feature}) => ({...nearestPointOnOutline(coordinate, outlinesOf(feature.geometry)), points: []}))
  ];
}
