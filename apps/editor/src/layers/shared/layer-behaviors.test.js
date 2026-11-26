import test from 'node:test';
import assert from 'node:assert/strict';
import {createBehaviorContext} from './layer-behaviors.js';

const entries = [
  {key: 'way/1', feature: {properties: {entityId: 'way/1'}}},
  {key: '2', feature: {properties: {entityId: 'node/9'}}}
];

function contextWith(overrides = {}) {
  return createBehaviorContext({
    session: {name: 'session'},
    rules: {name: 'rules'},
    levels: new Set([0, 1]),
    map: {name: 'map'},
    layer: {id: 'roads'},
    isPhone: () => false,
    isMagnetOn: () => true,
    entriesOf: () => entries,
    shownLevel: () => 1,
    select: entry => entry.key,
    ...overrides
  });
}

test('a behavior context finds an entry by its local key or its source identity', () => {
  const context = contextWith();
  assert.equal(context.findEntity('roads.geojson', '2'), entries[1]);
  assert.equal(context.findEntity('roads.geojson', 'node/9'), entries[1]);
  assert.equal(context.findEntity('roads.geojson', 'missing'), undefined);
  assert.deepEqual(context.entriesOf('roads.geojson'), entries);
});

test('a behavior context passes the host state to its hooks', () => {
  let shownLevel = null;
  const context = contextWith({shownLevel: () => shownLevel});
  assert.equal(context.session.name, 'session');
  assert.equal(context.rules.name, 'rules');
  assert.deepEqual([...context.levels], [0, 1]);
  assert.equal(context.map.name, 'map');
  assert.equal(context.layer.id, 'roads');
  assert.equal(context.isPhone(), false);
  assert.equal(context.isMagnetOn(), true);
  assert.equal(context.shownLevel(), null);
  shownLevel = -1;
  assert.equal(context.shownLevel(), -1, 'the context reads the level when asked, not when it was made');
  assert.equal(context.select({key: 'way/1'}), 'way/1');
});
