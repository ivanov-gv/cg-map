import {pointInsidePolygon} from './geometry-validation.js';

const scanLineCount = 9;

function crossingsAt(latitude, rings) {
  const crossings = [];
  for (const ring of rings) {
    for (let index = 1; index < ring.length; index += 1) {
      const [start, end] = [ring[index - 1], ring[index]];
      if (start[1] > latitude === end[1] > latitude) continue;
      crossings.push(start[0] + ((latitude - start[1]) / (end[1] - start[1])) * (end[0] - start[0]));
    }
  }
  return crossings.sort((first, second) => first - second);
}

// The middle of the widest stretch inside the shape on a few parallel lines: a place for a label or a place marker that
// is inside any shape, including one with a courtyard, which a centre of corners is not.
export function interiorPoint(rings) {
  const latitudes = rings[0].map(([, latitude]) => latitude);
  const south = Math.min(...latitudes);
  const height = Math.max(...latitudes) - south;
  let widest = {width: -1, point: rings[0][0]};
  for (let line = 1; line <= scanLineCount; line += 1) {
    const latitude = south + (height * line) / (scanLineCount + 1);
    const crossings = crossingsAt(latitude, rings);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const width = crossings[index + 1] - crossings[index];
      if (width > widest.width) widest = {width, point: [(crossings[index] + crossings[index + 1]) / 2, latitude]};
    }
  }
  return widest.point;
}

export const isInside = (point, rings) => pointInsidePolygon(point, rings);
