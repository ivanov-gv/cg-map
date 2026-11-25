import {editTools} from './edit-transaction.js';
import {
  distanceMetres,
  formatArea,
  formatLength,
  lineLengthMetres,
  ringAreaSquareMetres
} from './geometry-measures.js';

const deskHints = {
  [editTools.placePoint]: 'Click the map to place it',
  [editTools.drawLine]: 'Click to add points · double-click to finish',
  [editTools.drawPolygon]: 'Click to place corners · Shift keeps 90° · click the first corner to close',
  [editTools.cutHole]: 'Draw the hole · click the first corner to close',
  [editTools.vertices]: 'Drag a point, or a small one to add a point',
  [editTools.move]: 'Drag anywhere on the map to move it'
};
const phoneHints = {
  ...deskHints,
  [editTools.placePoint]: 'Move the map until the cross is on it',
  [editTools.drawLine]: 'Move the map until the cross is on the point',
  [editTools.drawPolygon]: 'Move the map until the cross sits on the corner',
  [editTools.cutHole]: 'Move the map until the cross sits on the corner'
};

export const drawingHint = (tool, isPhone) => (isPhone ? phoneHints : deskHints)[tool] ?? '';

// The length of the side being drawn, and what the shape measures so far.
export function drawingMeasure({tool, drawnPoints}, nextPoint) {
  if (drawnPoints.length === 0) return '';
  const points = nextPoint ? [...drawnPoints, nextPoint] : drawnPoints;
  const sideText = nextPoint ? formatLength(distanceMetres(drawnPoints.at(-1), nextPoint)) : '';
  if (tool === editTools.drawLine) return `${sideText} · ${formatLength(lineLengthMetres(points))} in all`;
  const areaText = points.length > 2 ? formatArea(ringAreaSquareMetres(points)) : '';
  return [sideText, areaText].filter(Boolean).join(' · ');
}
