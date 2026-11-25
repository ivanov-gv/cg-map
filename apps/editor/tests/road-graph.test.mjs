import test from 'node:test';
import assert from 'node:assert/strict';
import {junctionBehaviors, junctionEntry, junctionFile} from '../src/layer-junctions.js';
import {disconnectEdits, followingEdits, joinEdits, junctionEdits, levelChoiceKey, movedPoints, roadWithEnds, splitEdits} from '../src/road-edits.js';
import {jointAt, jointNear, jointsIn, levelsOf, nearestToGround, roadLevel} from '../src/road-graph.js';
import {ruleOfTurn, turnKey, turnsAt} from '../src/road-junctions.js';

const origin = [19.25, 42.44];
// About eight metres east and eleven north.
const step = 0.0001;
const at = (east, north) => [origin[0] + east * step, origin[1] + north * step].map(value => Math.round(value * 1e7) / 1e7);
const line = points => ({type: 'LineString', coordinates: points.map(([east, north]) => at(east, north))});
const road = (points, properties = {}) => ({
  type: 'Feature',
  properties: {kind: 'residential', ...properties},
  geometry: line(points)
});
const entriesFrom = (filename, features) => features.map((feature, index) => ({filename, key: String(index), feature}));
const everything = [19.2, 42.4, 19.3, 42.5];
const stepsOf = ([longitude, latitude]) =>
  [(longitude - origin[0]) / step, (latitude - origin[1]) / step].map(value => Math.round(value * 10) / 10);

function contextWith({roads, nodes = [], rules = []}) {
  const entries = {
    'roads.geojson': entriesFrom('roads.geojson', roads),
    'road-nodes.geojson': entriesFrom('road-nodes.geojson', nodes),
    'turn-restrictions.json': entriesFrom('turn-restrictions.json', rules)
  };
  const properties = {kind: {}, name: {}, startNode: {}, endNode: {}, startLevel: {}, endLevel: {}};
  return {
    entriesOf: filename => entries[filename] ?? [],
    isPhone: () => false,
    rules: {layers: {'roads.geojson': {properties}}}
  };
}

const roadsOf = context => context.entriesOf('roads.geojson');
const afterOf = (edits, key) => edits.find(edit => edit.key === key && edit.filename === 'roads.geojson')?.after;

test('a road has the level of its layer, or of a bridge or tunnel, and its ends their own', () => {
  assert.deepEqual([{layer: '2'}, {bridge: 'yes'}, {tunnel: 'building_passage'}, {bridge: 'no'}, {}].map(roadLevel), [2, 1, -1, 0, 0]);
  const stairs = road([[0, 0], [1, 0]], {layer: '-1', startLevel: -1, endLevel: 0});
  assert.deepEqual(levelsOf(stairs), [-1, 0]);
  assert.deepEqual([[2, 1], [-2, -1], [-1, 1]].map(nearestToGround), [1, -1, 1]);
});

test('roads join where they share a point on one level, at an end or in the middle', () => {
  const roads = entriesFrom('roads.geojson', [road([[0, 0], [1, 0], [2, 0]]), road([[1, 0], [1, 1]]), road([[1, 1], [2, 1]])]);
  const joined = jointAt(at(1, 0), roads);
  assert.equal(joined.status, 'joined');
  assert.deepEqual(joined.members.map(({entry, end}) => [entry.key, end]), [['0', null], ['1', 'start']]);
  assert.equal(jointAt(at(2, 1), roads).status, 'deadEnd');
  assert.equal(jointAt(at(5, 5), roads), null);
});

test('what touches, crosses or nearly meets without joining is found, and a bridge over a street is not', () => {
  const street = road([[0, 0], [4, 0]]);
  const statuses = (...others) => {
    const joints = jointsIn(everything, entriesFrom('roads.geojson', [street, ...others]));
    return joints.map(({status}) => status).filter(status => !['joined', 'deadEnd'].includes(status));
  };
  assert.deepEqual(statuses(road([[2, -1], [2, 1]])), ['crossing']);
  assert.deepEqual(statuses(road([[2, -1], [2, 1]], {bridge: 'yes'})), []);
  assert.deepEqual(statuses(road([[2, 0.05], [2, 1]])), ['near']);
  assert.deepEqual(statuses(road([[4, 0], [5, 0]], {startLevel: 1})), ['apart']);
  assert.deepEqual(statuses(road([[4, 0], [5, 0]])), []);
});

test('turns go from every arm someone may arrive on to every arm they may leave on', () => {
  const roads = entriesFrom('roads.geojson', [
    road([[0, 0], [1, 0]], {name: 'West', oneway: 'yes'}),
    road([[1, 0], [2, 0]], {name: 'East'}),
    road([[1, 0], [1, 1]], {name: 'Stairs', kind: 'steps'}),
    road([[1, 1], [1, 0]], {name: 'North', oneway: 'yes'})
  ]);
  const turns = turnsAt(jointAt(at(1, 0), roads));
  const names = turns.map(({from, turns: leaving}) => [from.member.entry.feature.properties.name, leaving.map(({kind}) => kind)]);
  // Nobody drives up the stairs, and the one-way roads are only arrived on.
  assert.deepEqual(names, [['West', ['straight']], ['East', ['uTurn']], ['North', ['left']]]);
});

test('a forbidden turn names roads and junctions of the editor too, and gives the junction an ID', () => {
  const context = contextWith({
    roads: [road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 12, endLevel: 0}), road([[1, 0], [1, 1]], {entityId: 'local:drawn'})]
  });
  const joint = jointAt(at(1, 0), roadsOf(context));
  const [{from, turns}] = turnsAt(joint);
  const left = turns.find(({kind}) => kind === 'left');
  const edits = junctionEdits(joint, joint.coordinate, {[turnKey(from, left.to)]: false}, context);
  const rule = edits.find(({filename}) => filename === 'turn-restrictions.json').after;
  assert.deepEqual(rule.properties, {restriction: 'no_left_turn', from: 1, to: 'local:drawn', viaNodes: [12]});
  assert.deepEqual(
    [afterOf(edits, '1').properties.startNode, afterOf(edits, '1').properties.startLevel],
    [12, 0],
    'both roads end at the junction that the rule names'
  );
});

test('an allowed turn takes its rule back, and an "only" rule stays', () => {
  const ruleOf = properties => ({type: 'Feature', geometry: null, properties: {from: 1, viaNodes: [12], ...properties}});
  const roads = [road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 12}), road([[1, 0], [1, 1]], {entityId: 'way/2', startNode: 12})];
  const context = contextWith({roads, rules: [ruleOf({restriction: 'no_left_turn', to: 2})]});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const [{from, turns, members}] = turnsAt(joint);
  const left = turns.find(({kind}) => kind === 'left');
  assert.equal(ruleOfTurn(context.entriesOf('turn-restrictions.json'), from, left.to, members).isForbidden, true);
  const choice = {[turnKey(from, left.to)]: true};
  assert.deepEqual(junctionEdits(joint, joint.coordinate, choice, context), [{filename: 'turn-restrictions.json', key: '0', after: null}]);
  const onlyContext = contextWith({roads, rules: [ruleOf({restriction: 'only_right_turn', to: 9})]});
  assert.deepEqual(junctionEdits(joint, joint.coordinate, choice, onlyContext), []);
});

test('a light is put up, changed and taken down at a junction', () => {
  const light = {type: 'Feature', properties: {kind: 'traffic_signals', entityId: 'node/5', traffic_signals: 'signal'}, geometry: {type: 'Point', coordinates: at(1, 0)}};
  const roads = [road([[0, 0], [1, 0]]), road([[1, 0], [1, 1]])];
  const bare = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(bare));
  const [added] = junctionEdits(joint, joint.coordinate, {furniture: 'traffic_signals'}, bare);
  assert.deepEqual([added.after.properties, added.after.geometry.coordinates], [{kind: 'traffic_signals'}, at(1, 0)]);
  const lit = contextWith({roads, nodes: [light]});
  const [changed] = junctionEdits(joint, joint.coordinate, {furniture: 'stop'}, lit);
  assert.deepEqual(changed.after.properties, {kind: 'stop', entityId: 'node/5'});
  const [removed] = junctionEdits(joint, joint.coordinate, {furniture: ''}, lit);
  assert.equal(removed.after, null);
  const moved = junctionEdits(joint, at(1, 0.1), {}, lit);
  const movedLight = moved.find(({filename}) => filename === 'road-nodes.geojson').after;
  assert.deepEqual(movedLight.geometry.coordinates, at(1, 0.1));
  assert.deepEqual(stepsOf(afterOf(moved, '0').geometry.coordinates.at(-1)), [1, 0.1]);
  assert.deepEqual(stepsOf(afterOf(moved, '1').geometry.coordinates[0]), [1, 0.1]);
});

test('an end put on another level leaves the junction, and both share one again when they are joined', () => {
  const roads = [road([[0, 0], [1, 0]], {endNode: 12, endLevel: 0}), road([[1, 0], [2, 0]], {startNode: 12, startLevel: 0})];
  const context = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const edits = junctionEdits(joint, joint.coordinate, {[levelChoiceKey(joint.members[1])]: 1}, context);
  const raised = afterOf(edits, '1').properties;
  assert.equal(raised.startLevel, 1);
  assert.match(raised.startNode, /^local:/);
  assert.equal(afterOf(edits, '0').properties.endNode, 12);
  const apart = contextWith({roads: [roads[0], afterOf(edits, '1')]});
  const apartJoint = jointAt(at(1, 0), roadsOf(apart));
  assert.equal(apartJoint.status, 'apart');
  const {edits: joinedEdits} = joinEdits(apartJoint);
  const joined = joinedEdits.map(({after}) => [after.properties.endNode ?? after.properties.startNode, after.properties.endLevel ?? after.properties.startLevel]);
  assert.deepEqual(joined, [[12, 0], [12, 0]]);
});

test('roads that pass on different levels are not joined by force', () => {
  const roads = entriesFrom('roads.geojson', [road([[0, 0], [1, 0], [2, 0]]), road([[1, -1], [1, 0], [1, 1]], {tunnel: 'yes'})]);
  assert.match(joinEdits(jointAt(at(1, 0), roads)).problem, /different levels/);
});

test('an end that nearly meets a road is joined to it, and a crossing becomes a junction', () => {
  const near = entriesFrom('roads.geojson', [road([[0, 0], [4, 0]]), road([[2, 0.05], [2, 1]], {startNode: 7, startLevel: 0})]);
  const {edits} = joinEdits(jointNear(at(2, 0.05), near));
  assert.deepEqual(afterOf(edits, '0').geometry.coordinates.map(stepsOf), [[0, 0], [2, 0], [4, 0]]);
  assert.deepEqual(afterOf(edits, '1').geometry.coordinates.map(stepsOf), [[2, 0], [2, 1]]);
  const crossing = entriesFrom('roads.geojson', [road([[0, 0], [4, 0]]), road([[2, -1], [2, 1]])]);
  const [found] = jointsIn(everything, crossing).filter(({status}) => status === 'crossing');
  const joined = joinEdits(found).edits;
  for (const {after} of joined) assert.deepEqual(stepsOf(after.geometry.coordinates[1]), [2, 0]);
  const after = entriesFrom('roads.geojson', joined.map(edit => edit.after));
  assert.equal(jointAt(joined[0].after.geometry.coordinates[1], after).status, 'joined');
});

test('a disconnected end is pulled back and leaves its junction and the rules there, a passing road only its point', () => {
  const rule = {type: 'Feature', geometry: null, properties: {restriction: 'no_left_turn', from: 1, to: 2, viaNodes: [12]}};
  const context = contextWith({
    roads: [road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 12, endLevel: 0}), road([[1, -1], [1, 0], [1, 1]], {entityId: 'way/2'})],
    rules: [rule]
  });
  const joint = jointAt(at(1, 0), roadsOf(context));
  const ending = disconnectEdits(joint, joint.members[0], context);
  const pulled = afterOf(ending.edits, '0');
  assert.ok(stepsOf(pulled.geometry.coordinates[1])[0] < 1);
  assert.match(pulled.properties.endNode, /^local:/);
  assert.deepEqual(ending.edits[1], {filename: 'turn-restrictions.json', key: '0', after: null});
  const passing = disconnectEdits(joint, joint.members[1], context);
  assert.deepEqual(afterOf(passing.edits, '1').geometry.coordinates.map(stepsOf), [[1, -1], [1, 1]]);
});

test('roads are split at a junction in one step, and a rule at the far end follows its half', () => {
  const rule = {type: 'Feature', geometry: null, properties: {restriction: 'no_u_turn', from: 1, to: 1, viaNodes: [99]}};
  const context = contextWith({
    roads: [road([[0, 0], [1, 0], [2, 0]], {entityId: 'way/1', startNode: 98, endNode: 99}), road([[1, 0], [1, 1]], {startNode: 12})],
    rules: [rule]
  });
  const {edits, problem} = splitEdits(jointAt(at(1, 0), roadsOf(context)), context);
  assert.equal(problem, null);
  const second = edits.find(({key, filename}) => filename === 'roads.geojson' && key.startsWith('local:'));
  assert.deepEqual([afterOf(edits, '0').properties.endNode, second.after.properties.startNode], [12, 12]);
  assert.deepEqual(second.after.geometry.coordinates.map(stepsOf), [[1, 0], [2, 0]]);
  const ruled = edits.find(({filename}) => filename === 'turn-restrictions.json').after.properties;
  assert.deepEqual([ruled.from, ruled.to], [second.key, second.key]);
  const through = contextWith({
    roads: roadsOf(context).map(({feature}) => feature),
    rules: [{...rule, properties: {...rule.properties, viaNodes: undefined, viaWays: [1]}}]
  });
  assert.match(splitEdits(jointAt(at(1, 0), roadsOf(through)), through).problem, /turn rules/);
});

test('joined roads and what stands on the junction go with a moved point, also when points were added', () => {
  const light = {type: 'Feature', properties: {kind: 'crossing'}, geometry: {type: 'Point', coordinates: at(1, 0)}};
  const before = road([[0, 0], [1, 0], [2, 0]]);
  const context = contextWith({roads: [before, road([[1, 0], [1, 1]]), road([[1, 0], [1, -1]], {startLevel: -1})], nodes: [light]});
  const after = road([[0, 0], [0.5, 0], [1, 0.2], [2, 0]]);
  assert.deepEqual(movedPoints(before, after).map(({from, to}) => [stepsOf(from), stepsOf(to)]), [[[1, 0], [1, 0.2]]]);
  const edits = followingEdits({key: '0', before, feature: after}, context);
  assert.deepEqual(edits.map(({filename, key}) => `${filename} ${key}`), ['roads.geojson 1', 'road-nodes.geojson 0']);
  assert.deepEqual(stepsOf(afterOf(edits, '1').geometry.coordinates[0]), [1, 0.2]);
  assert.deepEqual(followingEdits({key: '0', before, feature: after}, context, new Set(['19.250100 42.440000'])), []);
});

test('a drawn end takes the junction and level it meets, and one taken away gets its own', () => {
  const roads = entriesFrom('roads.geojson', [
    road([[0, 0], [1, 0]], {endNode: 12, endLevel: -1}),
    road([[4, 0], [6, 0]], {layer: '1'})
  ]);
  const drawn = roadWithEnds({key: 'local:1', feature: road([[1, 0], [5, 0]]), before: null}, roads);
  assert.deepEqual([drawn.properties.startNode, drawn.properties.startLevel], [12, -1]);
  assert.equal(drawn.properties.endLevel, 1, 'the level of the road it is put on');
  assert.match(drawn.properties.endNode, /^local:/);
  const [{feature: before}] = roads;
  const moved = road([[0, 0], [1, 1]], {endNode: 12, endLevel: -1});
  assert.equal(roadWithEnds({key: '0', feature: moved, before}, roads).properties.endNode, 12, 'the junction moves along');
  const freed = roadWithEnds({key: '0', feature: moved, before}, roads, {freePoints: new Set(['19.250100 42.440000'])});
  assert.match(freed.properties.endNode, /^local:/);
});

test('a junction records its roads and never itself', () => {
  const context = contextWith({roads: [road([[0, 0], [1, 0]], {name: 'A'}), road([[1, 0], [2, 0]], {name: 'B'})]});
  const behavior = junctionBehaviors[junctionFile];
  const entry = junctionEntry(at(1, 0));
  assert.equal(behavior.title(entry.feature, context), 'A × B');
  assert.deepEqual(behavior.companionEdits({...entry, extras: {}}, context), []);
  const moved = {...entry, feature: {...entry.feature, geometry: {type: 'Point', coordinates: at(1, 1)}}, extras: {}};
  assert.deepEqual(behavior.companionEdits(moved, context).map(({filename, key}) => `${filename} ${key}`), ['roads.geojson 0', 'roads.geojson 1']);
  assert.equal(behavior.isDerived, true);
});
