import test from 'node:test';
import assert from 'node:assert/strict';
import {editTools} from '../src/editing/edit-transaction.js';
import {hasMagnetEffect} from '../src/map-tools/magnet-tools.js';

const area = {type: 'Polygon', coordinates: [[]]};
const line = {type: 'LineString', coordinates: []};
const point = {type: 'Point', coordinates: [19.25, 42.44]};

test('the switch is offered only where this mode can change a point of this object', () => {
  const cases = [
    [{tool: editTools.move, geometry: area, joins: true}, true, 'a moved area'],
    [{tool: editTools.vertices, geometry: area, joins: true}, true, 'an area corner'],
    [{tool: editTools.drawPolygon, geometry: null, joins: false}, true, 'a drawn outline'],
    [{tool: editTools.cutHole, geometry: null, joins: false}, true, 'a drawn hole'],
    [{tool: editTools.move, geometry: line, joins: true}, false, 'moving a line'],
    [{tool: editTools.vertices, geometry: line, joins: true}, true, 'a joining line point'],
    [{tool: editTools.vertices, geometry: line, joins: false}, false, 'a line point that cannot join'],
    [{tool: editTools.drawLine, geometry: line, joins: true}, true, 'a drawn joining line'],
    [{tool: editTools.drawLine, geometry: line, joins: false}, false, 'a drawn line that cannot join'],
    [{tool: editTools.move, geometry: point, joins: true}, true, 'a moved junction'],
    [{tool: editTools.vertices, geometry: point, joins: true}, false, 'a point with no corners'],
    [{tool: editTools.placePoint, geometry: null, joins: true}, false, 'placing a record']
  ];
  for (const [input, expected, name] of cases) {
    assert.equal(hasMagnetEffect(input), expected, name);
  }
});
