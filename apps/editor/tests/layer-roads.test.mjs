import test from 'node:test';
import assert from 'node:assert/strict';
import {roadBehaviors} from '../src/layer-roads.js';
import {jointAt} from '../src/road-graph.js';
import {rulesAfterSplit, turnKind, turnRule, turnsAt} from '../src/road-junctions.js';
import {joinedRoad, splitProblem, splitRoad, withJunctionAt} from '../src/road-shapes.js';

const road = (coordinates, properties = {}) => ({
  type: 'Feature',
  properties: {kind: 'residential', ...properties},
  geometry: {type: 'LineString', coordinates}
});
const west = [19.25, 42.44];
const centre = [19.251, 42.44];
const east = [19.252, 42.44];
const north = [19.251, 42.441];

test('a split keeps the identity on the first half and claims no node where the road was cut', () => {
  const whole = road([west, centre, east], {
    name: 'Main street',
    entityId: 'way/1',
    startNode: 11,
    startLevel: 0,
    endNode: 12,
    endLevel: 1
  });
  const rules = {name: {}, kind: {}, startNode: {}, startLevel: {}, endNode: {}, endLevel: {}};
  const [first, second] = splitRoad(whole, 1, rules);
  assert.deepEqual(first.geometry.coordinates, [west, centre]);
  assert.deepEqual(first.properties, {
    kind: 'residential',
    name: 'Main street',
    entityId: 'way/1',
    startNode: 11,
    startLevel: 0
  });
  assert.deepEqual(second.geometry.coordinates, [centre, east]);
  assert.deepEqual(second.properties, {kind: 'residential', name: 'Main street', endNode: 12, endLevel: 1});
  assert.equal(splitProblem(whole, 1), null);
  assert.match(splitProblem(whole, 0), /between the ends/);
  const unnamed = splitRoad(road([west, centre, east], {name: ''}), 1, rules)[1];
  assert.equal(unnamed.properties.name, undefined, 'a blank source name is not stated again');
});

test('roads join in whichever direction they meet, keeping the nodes of the far ends', () => {
  const first = road([west, centre], {entityId: 'way/1', startNode: 11, startLevel: 0, endNode: 12, endLevel: 0});
  const meetsBackwards = road([east, centre], {startNode: 13, startLevel: 1, endNode: 12, endLevel: 0});
  const joined = joinedRoad(first, meetsBackwards);
  assert.deepEqual(joined.geometry.coordinates, [west, centre, east]);
  assert.deepEqual(joined.properties, {
    kind: 'residential',
    entityId: 'way/1',
    startNode: 11,
    startLevel: 0,
    endNode: 13,
    endLevel: 1
  });
  const atStart = joinedRoad(road([centre, east]), road([centre, west]));
  assert.deepEqual(atStart.geometry.coordinates, [west, centre, east]);
  assert.equal(joinedRoad(first, road([east, north])), null);
});

test('a road gets a point where another touches it, and none where it already has one or is too far', () => {
  const crossed = withJunctionAt(road([west, east]), centre, 0.2);
  assert.deepEqual(crossed.geometry.coordinates, [west, centre, east]);
  assert.equal(withJunctionAt(road([west, centre, east]), centre, 0.2), null);
  assert.equal(withJunctionAt(road([west, east]), north, 0.2), null);
});

test('turns are named by their angle, and only roads on the same level meet', () => {
  assert.deepEqual([-90, 0, 90, 179].map(turnKind), ['left', 'straight', 'right', 'uTurn']);
  const entry = (key, feature) => ({key, feature});
  const joint = jointAt(centre, [
    entry('0', road([west, centre])),
    entry('1', road([centre, east])),
    entry('2', road([north, centre])),
    entry('3', road([centre, [19.251, 42.439]], {startLevel: 1}))
  ]);
  const {turns} = turnsAt(joint).find(({from}) => from.member.entry.key === '0');
  assert.deepEqual(
    turns.map(({to, kind}) => [to.member.entry.key, kind]),
    [
      ['0', 'uTurn'],
      ['1', 'straight'],
      ['2', 'left']
    ]
  );
});

function contextWith(featuresByFile) {
  return {
    isPhone: () => false,
    entriesOf: filename =>
      (featuresByFile[filename] ?? []).map((feature, index) => ({filename, key: String(index), feature}))
  };
}

test('a drawn road gives the road it touches a point there, on its own level only', () => {
  const context = contextWith({
    'roads.geojson': [road([west, centre]), road([centre, east], {entityId: 'way/2', startNode: 12, startLevel: 0})]
  });
  const {companionEdits} = roadBehaviors['roads.geojson'];
  const drawn = road([[19.2515, 42.44], [19.2515, 42.4405]]);
  const [junction] = companionEdits({key: 'local:1', feature: drawn, before: null, extras: {}}, context);
  assert.deepEqual(junction.after.geometry.coordinates, [centre, [19.2515, 42.44], east]);
  const raised = {...drawn, properties: {...drawn.properties, startLevel: 1}};
  assert.deepEqual(companionEdits({key: 'local:1', feature: raised, before: null, extras: {}}, context), []);
});

const ruleOf = properties => ({type: 'Feature', properties: {from: 1, viaNodes: [12], ...properties}, geometry: null});

test('an "only" rule forbids the other turns of its junction, and a "no" rule its own turn', () => {
  const entries = [ruleOf({restriction: 'only_straight_on', to: 2})].map((feature, index) => ({key: String(index), feature}));
  assert.equal(turnRule(entries, 1, 2, 12).isForbidden, false);
  assert.equal(turnRule(entries, 1, 3, 12).isForbidden, true);
  assert.equal(turnRule(entries, 1, 3, 11).isForbidden, false, 'another junction');
  const forbidding = [{key: '0', feature: ruleOf({restriction: 'no_left_turn', to: 3})}];
  assert.equal(turnRule(forbidding, 1, 3, 12).isForbidden, true);
  assert.equal(turnRule(forbidding, 1, 2, 12).isForbidden, false);
});

test('a split gives a rule at the far end to its half, and is refused while a rule leads through the road', () => {
  const whole = road([west, centre, east], {entityId: 'way/1', startNode: 11, endNode: 12});
  const entry = {key: '0', feature: whole};
  const atEnd = {filename: 'turn-restrictions.json', key: '0', feature: ruleOf({restriction: 'no_left_turn', to: 3})};
  const atStart = {...atEnd, key: '1', feature: ruleOf({restriction: 'no_u_turn', to: 1, viaNodes: [11]})};
  const {edits} = rulesAfterSplit([atEnd, atStart], entry, 'local:half');
  assert.deepEqual(edits.map(({entry: rule, renamed}) => [rule.key, renamed(rule.feature.properties).from]), [['0', 'local:half']]);
  const through = {...atEnd, feature: ruleOf({restriction: 'no_left_turn', from: 5, to: 3, viaWays: [1], viaNodes: undefined})};
  const problems = [];
  const edit = {
    isNew: false,
    key: '0',
    feature: whole,
    extras: {},
    context: {...contextWith({'turn-restrictions.json': [through.feature]}), rules: {layers: {'roads.geojson': {properties: {}}}}},
    showProblem: message => problems.push(message),
    hasUnappliedEdit: () => false,
    replaceWith: () => assert.fail('nothing is split')
  };
  const split = roadBehaviors['roads.geojson'].vertexTools(whole, {vertexIndex: 1}, edit).find(({id}) => id === 'vertex-split');
  split.run();
  assert.match(problems[0], /turn rules that a split would lose/);
});

test('deleting a road takes its turn rules, which would name a road that is gone', () => {
  const rule = {type: 'Feature', properties: {restriction: 'no_u_turn', from: 2, to: 1}, geometry: null};
  const context = contextWith({'turn-restrictions.json': [rule, {...rule, properties: {...rule.properties, to: 3}}]});
  const {edits, message} = roadBehaviors['roads.geojson'].deletion({feature: road([west, east], {entityId: 'way/1'})}, context);
  assert.deepEqual(edits, [{filename: 'turn-restrictions.json', key: '0', after: null}]);
  assert.match(message, /1 turn rules/);
});
