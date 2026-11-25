// Where the magnet can change a point of the open object. The switch is shown only for these modes and shapes.
import {isArea} from './area-magnet.js';
import {editTools} from './edit-transaction.js';

const outlineTools = new Set([editTools.drawPolygon, editTools.cutHole]);
const joiningTools = new Set([editTools.drawLine, editTools.vertices]);

export function hasMagnetEffect({tool, geometry, joins = false}) {
  if (tool === editTools.placePoint) return false;
  // An outline is drawn point by point, so its geometry does not exist until the first corner.
  if (outlineTools.has(tool)) return true;
  if (tool === editTools.drawLine) return joins;
  if (isArea(geometry)) return tool === editTools.move || tool === editTools.vertices;
  if (geometry?.type === 'LineString') return joiningTools.has(tool) && joins;
  if (geometry?.type === 'Point') return tool === editTools.move;
  return false;
}
