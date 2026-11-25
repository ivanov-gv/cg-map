// Putting a point of a line where it joins another one: while drawing, while dragging, and taking it apart again.
import {removeVertex, roundedCoordinate} from './geometry-editing.js';
import {coordinateAtOffset, distanceMetres, metricOffset} from './geometry-measures.js';

const joinDistancePixels = 12;
// How far a disconnected end is pulled back along its line, so that nobody reads it as joined.
const pulledBackMetres = 1.5;

// Where a point put at this place joins a line close to it on the screen, or null. candidates are
// [{coordinate, distanceMetres, points}]: the nearest place of each line, and its own points.
export function joiningPoint(coordinate, candidates, map) {
  if (candidates.length === 0) return null;
  const nearest = candidates.reduce((first, second) => (second.distanceMetres < first.distanceMetres ? second : first));
  const point = map.project(coordinate);
  const isWithinReach = position => point.dist(map.project(position)) <= joinDistancePixels;
  // An existing point is joined rather than a new one beside it.
  const existingPoint = nearest.points.find(isWithinReach);
  if (existingPoint) return existingPoint;
  return isWithinReach(nearest.coordinate) ? roundedCoordinate(nearest.coordinate) : null;
}

export const withPoint = (geometry, index, coordinate) => ({
  ...geometry,
  coordinates: geometry.coordinates.with(index, coordinate)
});

// The end of a line a little back along it, or null when the line has no length there.
function pulledBack(coordinates, index) {
  const last = coordinates[index];
  const before = index === 0 ? coordinates[1] : coordinates[index - 1];
  const length = distanceMetres(last, before);
  if (length === 0) return null;
  const [east, north] = metricOffset(before, last);
  const fraction = Math.min(pulledBackMetres / length, 0.5);
  return roundedCoordinate(coordinateAtOffset([east * fraction, north * fraction], last));
}

// A line without the join at one of its points: an end is pulled back, and a line that passes goes on without the point.
// null when the line is too short for that.
export function withoutJoin(geometry, index) {
  const isInner = index > 0 && index < geometry.coordinates.length - 1;
  if (isInner) return removeVertex(geometry, {vertexIndex: index});
  const coordinate = pulledBack(geometry.coordinates, index);
  return coordinate ? withPoint(geometry, index, coordinate) : null;
}
