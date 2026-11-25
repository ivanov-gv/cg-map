import test from 'node:test';
import assert from 'node:assert/strict';
import {DragBudget} from '../src/drag-budget.js';
import {followingShapes} from '../src/following-shapes.js';

const lineTo = east => ({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: [[0, 0], [east, 0]]}});

test('what moves, comes or goes is shown as it would be and as it is, and what only changes its facts is not', () => {
  const features = {moved: lineTo(1), renamed: lineTo(2), removed: lineTo(3), rule: {geometry: null}};
  const edits = [
    {filename: 'a', key: 'moved', after: lineTo(5)},
    {filename: 'a', key: 'renamed', after: {...lineTo(2), properties: {name: 'New'}}},
    {filename: 'a', key: 'removed', after: null},
    {filename: 'a', key: 'added', after: lineTo(6)},
    {filename: 'b', key: 'rule', after: null}
  ];
  const {shapes, ghosts} = followingShapes(edits, (_filename, key) => features[key] ?? null);
  assert.deepEqual(shapes, [lineTo(5), lineTo(6)]);
  assert.deepEqual(ghosts, [lineTo(1), lineTo(3)]);
});

test('a drag does not wait for what is slow to find, and its end shows it', testContext => {
  let now = 0;
  testContext.mock.method(performance, 'now', () => now);
  const preview = new DragBudget();
  const found = {problem: null, shapes: [lineTo(1)], ghosts: []};
  const nothing = {};
  let askedCount = 0;
  const find = () => {
    askedCount += 1;
    now += 100;
    return found;
  };
  for (let move = 0; move < 5; move += 1) preview.of(find, true, nothing);
  assert.equal(askedCount, 3);
  assert.equal(preview.of(find, true, nothing), nothing);
  assert.equal(preview.of(find, false, nothing), found);
  preview.forget();
  assert.equal(preview.of(find, true, nothing), found, 'another object can be quick');
});
