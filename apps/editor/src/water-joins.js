// Where rivers meet rivers and water areas. A join is kept when either side moves.
import {roundedCoordinate} from './geometry-editing.js';
import {nearestPointOnOutline} from './geometry-measures.js';
import {endsOf, isSamePoint} from './road-shapes.js';

// Source lines end on an outline up to rounding and simplification.
const joinToleranceMetres = 1;

const isLine = ({feature}) => feature.geometry.type === 'LineString';
const isArea = ({feature}) => feature.geometry.type === 'Polygon';

// The same line the other way around moves no point, only the order in which they are passed.
const isReversal = (before, after) => JSON.stringify(before) === JSON.stringify(after.toReversed());

// The points that an edit moved, as pairs. A point added or removed moves none.
export function movedPoints(before, after) {
  if (before.length !== after.length || isReversal(before, after)) return [];
  return before.flatMap((point, index) => (isSamePoint(point, after[index]) ? [] : [{from: point, to: after[index]}]));
}

function withPointsMoved(line, moves) {
  return line.map(point => moves.find(({from}) => isSamePoint(from, point))?.to ?? point);
}

// Other lines that share a moved point go with it.
export function linesKeepingJoins(key, before, after, waterEntries) {
  const moves = movedPoints(before.coordinates, after.coordinates);
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
  const coordinates = [...after.coordinates];
  for (const index of [0, coordinates.length - 1]) {
    const isMoved = !isSamePoint(before.coordinates[index], coordinates[index]);
    const shore = isMoved && areas.find(({feature}) => isOnOutline(before.coordinates[index], feature.geometry.coordinates));
    if (shore) coordinates[index] = onOutline(coordinates[index], shore.feature.geometry.coordinates);
  }
  return {...after, coordinates};
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
