// Contour lines never cross, each other or themselves, and a summit is higher than the closed lines around it.
import {isSamePoint} from './road-shapes.js';

const crossProduct = (first, second, third) =>
  (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);

const isApart = (first, second) =>
  [0, 1].some(
    axis =>
      Math.max(first[0][axis], first[1][axis]) < Math.min(second[0][axis], second[1][axis]) ||
      Math.max(second[0][axis], second[1][axis]) < Math.min(first[0][axis], first[1][axis])
  );

// Whether two segments pass through each other. Touching counts: two heights cannot share a point.
function segmentsMeet(first, second) {
  if (isApart(first, second)) return false;
  const sides = [
    crossProduct(...first, second[0]) * crossProduct(...first, second[1]),
    crossProduct(...second, first[0]) * crossProduct(...second, first[1])
  ];
  return sides.every(side => side <= 0);
}

const segmentsOf = line => line.slice(1).map((end, index) => [line[index], end]);

// The segments of a line that were not there before.
function changedSegments(line, previousLine) {
  const known = new Set(segmentsOf(previousLine ?? []).map(String));
  return segmentsOf(line).filter(segment => !known.has(String(segment)));
}

function boundsOf(line) {
  const values = axis => line.map(point => point[axis]);
  return [
    [Math.min(...values(0)), Math.min(...values(1))],
    [Math.max(...values(0)), Math.max(...values(1))]
  ];
}

function crossesItself(line, segments) {
  return segments.some(segment =>
    segmentsOf(line).some(other => {
      const isNeighbour = segment.some(point => other.some(otherPoint => isSamePoint(point, otherPoint)));
      return !isNeighbour && segmentsMeet(segment, other);
    })
  );
}

// Whether the changed part of a contour meets another line or itself. The unchanged part was judged before.
export function crossesContours(line, previousLine, otherLines) {
  const segments = changedSegments(line, previousLine);
  if (segments.length === 0) return false;
  const bounds = boundsOf(segments.flat());
  const meetsOther = otherLines.some(other => {
    if (isApart(bounds, boundsOf(other))) return false;
    return segmentsOf(other).some(otherSegment => segments.some(segment => segmentsMeet(segment, otherSegment)));
  });
  return meetsOther || crossesItself(line, segments);
}

export const isClosedLine = line => line.length > 3 && isSamePoint(line[0], line.at(-1));

// Both ends of a closed line are one point, so they move together.
export function keptClosed(line, previousLine) {
  if (!isClosedLine(previousLine) || line.length !== previousLine.length) return line;
  if (!isSamePoint(line[0], previousLine[0])) return [...line.slice(0, -1), line[0]];
  if (!isSamePoint(line.at(-1), previousLine.at(-1))) return [line.at(-1), ...line.slice(1)];
  return line;
}

// Ray casting on a closed line.
function surrounds(line, [longitude, latitude]) {
  let isInside = false;
  for (const [start, end] of segmentsOf(line)) {
    if (start[1] > latitude === end[1] > latitude) continue;
    const crossing = start[0] + ((latitude - start[1]) / (end[1] - start[1])) * (end[0] - start[0]);
    if (longitude < crossing) isInside = !isInside;
  }
  return isInside;
}

// The height of the highest closed contour around a point, or null where there is none.
export function highestContourAround(coordinate, contours) {
  const heights = contours
    .filter(({feature}) => {
      const line = feature.geometry.coordinates;
      return isClosedLine(line) && surrounds(line, coordinate);
    })
    .map(({feature}) => feature.properties.elevation);
  return heights.length > 0 ? Math.max(...heights) : null;
}
