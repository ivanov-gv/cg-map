// Which point of a line before an edit each of its points is now. Points are added, moved and removed one by one, and only
// their positions tell a removed point from a moved one: afterwards the coordinates alone do not.
import {pointKey} from './road-graph.js';

// The origins of a line that nothing has happened to: every point is itself. null is a point that was added.
export const startingOrigins = ({coordinates}) => coordinates.map((_point, index) => index);

const isReversed = (keys, nextKeys) => keys.length > 2 && keys.toReversed().every((key, index) => key === nextKeys[index]);

// The points that both lines have, in order, as pairs of positions.
function sharedPoints(keys, nextKeys) {
  const shared = [];
  let from = 0;
  keys.forEach((key, index) => {
    const nextIndex = nextKeys.indexOf(key, from);
    if (nextIndex < 0) return;
    shared.push([index, nextIndex]);
    from = nextIndex + 1;
  });
  return shared;
}

// Origins after a change whose steps are not known, such as a tool of a layer. As many points as before are the same ones
// moved. Otherwise a point that is still there is itself, and between two of those as many points as before are the same.
export function originsAfter(coordinates, origins, nextCoordinates) {
  const keys = coordinates.map(pointKey);
  const nextKeys = nextCoordinates.map(pointKey);
  if (isReversed(keys, nextKeys)) return origins.toReversed();
  if (keys.length === nextKeys.length) return origins;
  const next = nextKeys.map(() => null);
  const anchors = [[-1, -1], ...sharedPoints(keys, nextKeys), [keys.length, nextKeys.length]];
  anchors.slice(1).forEach(([end, nextEnd], gap) => {
    const [start, nextStart] = anchors[gap];
    if (end - start === nextEnd - nextStart) {
      for (let offset = 1; offset < end - start; offset += 1) next[nextStart + offset] = origins[start + offset];
    }
    if (end < keys.length) next[nextEnd] = origins[end];
  });
  return next;
}

// The points that an edit moved: [{from, to, index, nextIndex}]. A point that was taken out moved nowhere.
export function movedPoints(before, after, origins = originsAfter(before.coordinates, startingOrigins(before), after.coordinates)) {
  return after.coordinates.flatMap((to, nextIndex) => {
    const index = origins[nextIndex];
    if (index === null || index === undefined) return [];
    const from = before.coordinates[index];
    return pointKey(from) === pointKey(to) ? [] : [{from, to, index, nextIndex}];
  });
}
