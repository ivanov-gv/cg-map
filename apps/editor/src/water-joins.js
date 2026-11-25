// Where rivers meet rivers and water areas. A join is kept when either side moves.
import {roundedCoordinate} from './geometry-editing.js';
import {distanceMetres, nearestPointOnLine, nearestPointOnOutline} from './geometry-measures.js';
import {entriesWithin, isWithin, pointKey, unjoinedCrossings} from './road-graph.js';
import {endsOf, isSamePoint, withJunctionAt} from './road-shapes.js';

// Source lines end on an outline up to rounding and simplification.
const joinToleranceMetres = 1;
// An end this close to other water was probably meant to join it.
const nearMissMetres = 5;
// A point put on another line lies on it up to rounding.
const touchMetres = 0.2;

const isLine = ({feature}) => feature.geometry.type === 'LineString';
const isArea = ({feature}) => feature.geometry.type === 'Polygon';

// The same line the other way around moves no point, only the order in which they are passed.
const isReversal = (before, after) => JSON.stringify(before) === JSON.stringify(after.toReversed());

const hasPoint = (line, coordinate) => line.some(point => isSamePoint(point, coordinate));

function nearestPoint(points, coordinate) {
  return points.reduce((nearest, point) =>
    distanceMetres(point, coordinate) < distanceMetres(nearest, coordinate) ? point : nearest
  );
}

// Where a point that a line no longer has went. With as many points as before that is the one in its place. Where points
// were added or removed too it is the nearest new one, or the nearest one left.
function successorOf(point, index, before, after) {
  if (index === 0) return after[0];
  if (index === before.length - 1) return after.at(-1);
  const inItsPlace = after[index];
  if (before.length === after.length && !hasPoint(before, inItsPlace)) return inItsPlace;
  const newPoints = after.filter(candidate => !hasPoint(before, candidate));
  return nearestPoint(newPoints.length > 0 ? newPoints : after, point);
}

// The points that an edit moved or took away, each with the one that stands for it now.
export function movedPoints(before, after) {
  if (isReversal(before, after)) return [];
  return before.flatMap((point, index) =>
    hasPoint(after, point) ? [] : [{from: point, to: successorOf(point, index, before, after)}]
  );
}

function withPointsMoved(line, moves) {
  return line.map(point => moves.find(({from}) => isSamePoint(from, point))?.to ?? point);
}

// Other lines that share a moved point go with it.
export function linesKeepingJoins(key, before, after, waterEntries, freePoints = new Set()) {
  const moves = movedPoints(before.coordinates, after.coordinates).filter(({from}) => !freePoints.has(pointKey(from)));
  if (moves.length === 0) return [];
  return waterEntries.filter(entry => isLine(entry) && entry.key !== key).flatMap(({filename, key: otherKey, feature}) => {
    const coordinates = withPointsMoved(feature.geometry.coordinates, moves);
    const isMoved = coordinates.some((point, index) => point !== feature.geometry.coordinates[index]);
    return isMoved ? [{filename, key: otherKey, after: {...feature, geometry: {...feature.geometry, coordinates}}}] : [];
  });
}

const isOnOutline = (point, rings) => nearestPointOnOutline(point, rings).distanceMetres <= joinToleranceMetres;
const onOutline = (point, rings) => roundedCoordinate(nearestPointOnOutline(point, rings).coordinate);

// Rivers that ended on a water area's shore still end on it after the shore moved.
export function riversKeepingShore(before, after, waterEntries) {
  return waterEntries.filter(isLine).flatMap(({filename, key, feature}) => {
    const {coordinates} = feature.geometry;
    const next = [...coordinates];
    for (const index of [0, coordinates.length - 1]) {
      const wasOnShore = isOnOutline(coordinates[index], before.coordinates);
      if (wasOnShore && !isOnOutline(coordinates[index], after.coordinates)) {
        next[index] = onOutline(coordinates[index], after.coordinates);
      }
    }
    const isMoved = next.some((point, index) => point !== coordinates[index]);
    return isMoved ? [{filename, key, after: {...feature, geometry: {...feature.geometry, coordinates: next}}}] : [];
  });
}

// A river whose end was on a shore ends on that shore wherever it is dragged.
export function riverEndingOnShores(before, after, waterEntries) {
  if (!before || movedPoints(before.coordinates, after.coordinates).length === 0) return after;
  const areas = waterEntries.filter(isArea);
  // Ends are compared with ends: points can have been added or removed between them.
  const endOnItsShore = (previousEnd, end) => {
    if (isSamePoint(previousEnd, end)) return end;
    const shore = areas.find(({feature}) => isOnOutline(previousEnd, feature.geometry.coordinates));
    return shore ? onOutline(end, shore.feature.geometry.coordinates) : end;
  };
  const [previousStart, previousEnd] = endsOf({geometry: before});
  const [start, end] = endsOf({geometry: after});
  const inner = after.coordinates.slice(1, -1);
  return {...after, coordinates: [endOnItsShore(previousStart, start), ...inner, endOnItsShore(previousEnd, end)]};
}

// What a river flows into at its last point: another line that has the point, or an area it ends on.
export function flowsInto({key, feature}, waterEntries) {
  const [, mouth] = endsOf(feature);
  return waterEntries.find(entry => {
    if (entry.key === key) return false;
    if (isLine(entry)) return entry.feature.geometry.coordinates.some(point => isSamePoint(point, mouth));
    return isArea(entry) && isOnOutline(mouth, entry.feature.geometry.coordinates);
  });
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

// Lines that water flows along. The coastline is the edge of the sea.
export const isWaterway = entry => isLine(entry) && entry.feature.properties.kind !== 'coastline';

const isNear = (point, {feature}) => {
  const rings = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return nearestPointOnOutline(point, rings).distanceMetres <= nearMissMetres;
};

// What the end of a line alone at its point is: on a shore it joins that water, beside other water it nearly does.
function statusOfLooseEnd(coordinate, key, entries) {
  const areas = entries.filter(isArea);
  if (areas.some(({feature}) => isOnOutline(coordinate, feature.geometry.coordinates))) return 'joined';
  const others = entries.filter(entry => entry.key !== key && (isWaterway(entry) || isArea(entry)));
  return others.some(entry => isNear(coordinate, entry)) ? 'near' : 'deadEnd';
}

// Every joint of the waterways in a view, as the road graph has them: [{coordinate, status}].
export function waterJointsIn(bounds, allEntries) {
  const entries = entriesWithin(allEntries.filter(entry => isLine(entry)), bounds).filter(isWaterway);
  const areas = allEntries.filter(isArea);
  const linesByPoint = new Map();
  for (const entry of entries) {
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
    return isEnd ? [{coordinate, status: statusOfLooseEnd(coordinate, entry.key, [...entries, ...areas])}] : [];
  });
  return [...joints, ...unjoinedCrossings(entries).filter(({coordinate}) => isWithin(coordinate, bounds))];
}

// The points of a waterway that others share, and the ends of it that lie on a shore.
export function joinedWaterPoints({key, feature}, waterEntries) {
  if (feature.geometry.type !== 'LineString') return [];
  const otherPoints = new Set(
    waterEntries
      .filter(entry => isWaterway(entry) && entry.key !== key)
      .flatMap(entry => entry.feature.geometry.coordinates.map(pointKey))
  );
  const areas = waterEntries.filter(isArea);
  const {coordinates} = feature.geometry;
  return coordinates.filter((point, index) => {
    const isEnd = index === 0 || index === coordinates.length - 1;
    const isOnShore = isEnd && areas.some(area => isOnOutline(point, area.feature.geometry.coordinates));
    return isOnShore || otherPoints.has(pointKey(point));
  });
}

// The nearest place of every other waterway, and of every shore for an end.
export function joinableWater(coordinate, waterEntries, ignoredKeys, isEnd) {
  const lines = waterEntries.filter(entry => isWaterway(entry) && !ignoredKeys.has(entry.key));
  const shores = isEnd ? waterEntries.filter(isArea) : [];
  return [
    ...lines.map(({feature}) => ({...nearestPointOnLine(coordinate, feature.geometry.coordinates), points: feature.geometry.coordinates})),
    ...shores.map(({feature}) => ({...nearestPointOnOutline(coordinate, feature.geometry.coordinates), points: []}))
  ];
}
