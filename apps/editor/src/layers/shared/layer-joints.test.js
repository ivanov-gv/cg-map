import test from 'node:test';
import assert from 'node:assert/strict';
import {entryOnShownLevel, jointOnShownLevel} from './layer-joints.js';

const road = (startLevel, endLevel = startLevel) => ({
  filename: 'roads.geojson',
  feature: {
    properties: {layer: startLevel, startLevel, endLevel},
    geometry: {type: 'LineString', coordinates: [[19.25, 42.44], [19.26, 42.44]]}
  }
});
const node = {filename: 'road-nodes.geojson', feature: {properties: {kind: 'crossing'}}};
const light = {filename: 'lights.geojson', feature: {properties: {}}};
const jointOf = (...entries) => ({members: entries.map(entry => ({entry})), level: 0});

test('one shown level keeps only the roads on it, and files without levels stay', () => {
  const ground = road(0);
  const below = road(-1);
  assert.equal(entryOnShownLevel(ground, null), true);
  assert.equal(entryOnShownLevel(below, null), true);
  assert.equal(entryOnShownLevel(ground, 0), true);
  assert.equal(entryOnShownLevel(below, 0), false);
  assert.equal(entryOnShownLevel(below, -1), true);
  assert.equal(entryOnShownLevel(node, 0), true, 'a crossing is kept with the ground');
  assert.equal(entryOnShownLevel(node, -1), false, 'a crossing does not follow a road onto another level');
  assert.equal(entryOnShownLevel(light, -1), true, 'a file without levels stays on every level');
});

test('a joint stays with any road that stays on the shown level', () => {
  const ground = jointOf(road(0), road(-1));
  assert.equal(jointOnShownLevel(ground, null), true);
  assert.equal(jointOnShownLevel(ground, 0), true);
  assert.equal(jointOnShownLevel(ground, -1), true);
  assert.equal(jointOnShownLevel(ground, 2), false);
  assert.equal(jointOnShownLevel({level: -1}, -1), true, 'a joint without members uses its own level');
  assert.equal(jointOnShownLevel({level: -1}, 0), false);
});
