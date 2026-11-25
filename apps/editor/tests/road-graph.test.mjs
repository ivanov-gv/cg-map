import test from 'node:test';
import assert from 'node:assert/strict';
import {junctionBehaviors, junctionEntry, junctionFile} from '../src/layer-junctions.js';
import {originsAfter, movedPoints, startingOrigins} from '../src/line-origins.js';
import {freePointsWithLevel, roadBehaviors} from '../src/layer-roads.js';
import {
  companionsOfRoad,
  disconnectEdits,
  disconnectProblem,
  joinEdits,
  junctionEdits,
  levelChoiceKey,
  roadWithEnds,
  splitEdits
} from '../src/road-edits.js';
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
  const identifier = {type: 'identifier'};
  const properties = {kind: {}, name: {}, startNode: identifier, endNode: identifier, startLevel: {}, endLevel: {}};
  return {
    entriesOf: filename => entries[filename] ?? [],
    isPhone: () => false,
    rules: {layers: {'roads.geojson': {properties}, 'road-nodes.geojson': {}}}
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
  const edits = junctionEdits(joint, joint.coordinate, {[turnKey(from, left.to)]: false}, context).edits;
  const rule = edits.find(({filename}) => filename === 'turn-restrictions.json').after;
  assert.deepEqual(rule.properties, {restriction: 'no_left_turn', from: 1, to: 'local:drawn', viaNodes: [12]});
  assert.deepEqual(
    [afterOf(edits, '1').properties.startNode, afterOf(edits, '1').properties.startLevel],
    [12, 0],
    'both roads end at the junction that the rule names'
  );
});

test('a forbidden turn at two unnamed ends gives both roads the one junction the rule names', () => {
  const context = contextWith({roads: [road([[0, 0], [1, 0]]), road([[1, 0], [1, 1]])]});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const {from, turns} = turnsAt(joint)[0];
  const left = turns.find(({kind}) => kind === 'left');
  const {edits} = junctionEdits(joint, joint.coordinate, {[turnKey(from, left.to)]: false}, context);
  const [rule] = edits.filter(({filename}) => filename === 'turn-restrictions.json');
  const nodes = ['0', '1'].map(key => afterOf(edits, key).properties).map(({startNode, endNode}) => startNode ?? endNode);
  assert.match(nodes[0], /^local:/);
  assert.equal(nodes[1], nodes[0], 'both roads end at the junction the rule names');
  assert.deepEqual(rule.after.properties.viaNodes, [nodes[0]]);
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
  assert.deepEqual(junctionEdits(joint, joint.coordinate, choice, context).edits, [{filename: 'turn-restrictions.json', key: '0', after: null}]);
  const onlyContext = contextWith({roads, rules: [ruleOf({restriction: 'only_right_turn', to: 9})]});
  assert.deepEqual(junctionEdits(joint, joint.coordinate, choice, onlyContext).edits, []);
});

test('a light is put up, changed and taken down at a junction', () => {
  const light = {type: 'Feature', properties: {kind: 'traffic_signals', entityId: 'node/5', traffic_signals: 'signal'}, geometry: {type: 'Point', coordinates: at(1, 0)}};
  const roads = [road([[0, 0], [1, 0]]), road([[1, 0], [1, 1]])];
  const bare = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(bare));
  const [added] = junctionEdits(joint, joint.coordinate, {furniture: 'traffic_signals'}, bare).edits;
  assert.deepEqual([added.after.properties, added.after.geometry.coordinates], [{kind: 'traffic_signals'}, at(1, 0)]);
  const lit = contextWith({roads, nodes: [light]});
  const [changed] = junctionEdits(joint, joint.coordinate, {furniture: 'stop'}, lit).edits;
  assert.deepEqual(changed.after.properties, {kind: 'stop', entityId: 'node/5'});
  const [removed] = junctionEdits(joint, joint.coordinate, {furniture: ''}, lit).edits;
  assert.equal(removed.after, null);
  const moved = junctionEdits(joint, at(1, 0.1), {}, lit).edits;
  const movedLight = moved.find(({filename}) => filename === 'road-nodes.geojson').after;
  assert.deepEqual(movedLight.geometry.coordinates, at(1, 0.1));
  assert.deepEqual(stepsOf(afterOf(moved, '0').geometry.coordinates.at(-1)), [1, 0.1]);
  assert.deepEqual(stepsOf(afterOf(moved, '1').geometry.coordinates[0]), [1, 0.1]);
});

test('an end put on another level leaves the junction, and both share one again when they are joined', () => {
  const roads = [road([[0, 0], [1, 0]], {endNode: 12, endLevel: 0}), road([[1, 0], [2, 0]], {startNode: 12, startLevel: 0})];
  const context = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const edits = junctionEdits(joint, joint.coordinate, {[levelChoiceKey(joint.members[1])]: 1}, context).edits;
  const raised = afterOf(edits, '1').properties;
  assert.equal(raised.startLevel, 1);
  assert.match(raised.startNode, /^local:/);
  assert.equal(afterOf(edits, '0'), undefined, 'the junction stays with the road that stayed');
  const apart = contextWith({roads: [roads[0], afterOf(edits, '1')]});
  const apartJoint = jointAt(at(1, 0), roadsOf(apart));
  assert.equal(apartJoint.status, 'apart');
  const {edits: joinedEdits} = joinEdits(apartJoint, apart);
  const joined = joinedEdits.map(({after}) => [after.properties.endNode ?? after.properties.startNode, after.properties.endLevel ?? after.properties.startLevel]);
  assert.deepEqual(joined, [[12, 0]]);
});

test('roads that pass on different levels are not joined by force', () => {
  const roads = entriesFrom('roads.geojson', [road([[0, 0], [1, 0], [2, 0]]), road([[1, -1], [1, 0], [1, 1]], {tunnel: 'yes'})]);
  assert.match(joinEdits(jointAt(at(1, 0), roads), contextWith({roads: []})).problem, /different levels/);
});

test('an end that nearly meets a road is joined to it, and a crossing becomes a junction', () => {
  const near = contextWith({roads: [road([[0, 0], [4, 0]]), road([[2, 0.05], [2, 1]], {startNode: 7, startLevel: 0})]});
  const {edits} = joinEdits(jointNear(at(2, 0.05), roadsOf(near)), near);
  assert.deepEqual(afterOf(edits, '0').geometry.coordinates.map(stepsOf), [[0, 0], [2, 0], [4, 0]]);
  assert.deepEqual(afterOf(edits, '1').geometry.coordinates.map(stepsOf), [[2, 0], [2, 1]]);
  const crossing = contextWith({roads: [road([[0, 0], [4, 0]]), road([[2, -1], [2, 1]])]});
  const [found] = jointsIn(everything, roadsOf(crossing)).filter(({status}) => status === 'crossing');
  const joined = joinEdits(found, crossing).edits;
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
  const ending = disconnectEdits(joint.members[0], context);
  const pulled = afterOf(ending.edits, '0');
  assert.ok(stepsOf(pulled.geometry.coordinates[1])[0] < 1);
  assert.match(pulled.properties.endNode, /^local:/);
  assert.deepEqual(ending.edits[1], {filename: 'turn-restrictions.json', key: '0', after: null});
  const passing = disconnectEdits(joint.members[1], context);
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

// What Apply of a road records, the road itself first.
function applied({key, before, coordinates, origins, properties = {}, freePoints = new Set(), extras = {}}, context) {
  const feature = {...before, properties: {...before.properties, ...properties}, geometry: line(coordinates)};
  const edit = {key, before, feature, origins, freePoints, extras};
  const own = roadWithEnds(edit, context);
  const {edits, problem} = companionsOfRoad({...edit, feature: own}, context);
  return {own, edits, problem};
}

test('joined roads and what stands on the junction go with a moved point, also when points were added', () => {
  const light = {type: 'Feature', properties: {kind: 'crossing'}, geometry: {type: 'Point', coordinates: at(1, 0)}};
  const before = road([[0, 0], [1, 0], [2, 0]]);
  const context = contextWith({roads: [before, road([[1, 0], [1, 1]]), road([[1, 0], [1, -1]], {startLevel: -1})], nodes: [light]});
  const change = {key: '0', before, coordinates: [[0, 0], [0.5, 0], [1, 0.2], [2, 0]], origins: [0, null, 1, 2]};
  const {edits} = applied(change, context);
  assert.deepEqual(edits.map(({filename, key}) => `${filename} ${key}`), ['roads.geojson 1', 'road-nodes.geojson 0']);
  assert.deepEqual(stepsOf(afterOf(edits, '1').geometry.coordinates[0]), [1, 0.2]);
  // Put where no other road is, so that it joins none.
  const freeChange = {...change, coordinates: [[0, 0], [0.5, 0], [1.3, 0.2], [2, 0]]};
  const freed = applied({...freeChange, freePoints: new Set(['19.250100 42.440000'])}, context);
  assert.deepEqual(freed.edits, []);
});

test('a point that was taken out moves nobody, and one added beside it takes no join', () => {
  const before = road([[0, 0], [1, 0], [2, 0], [3, 0]]);
  const context = contextWith({roads: [before, road([[1, 0], [1, 1]])]});
  // The joined point is removed and the next one dragged.
  const removed = applied({key: '0', before, coordinates: [[0, 0], [2, 0.5], [3, 0]], origins: [0, 2, 3]}, context);
  assert.deepEqual(removed.edits, []);
  // A point is added just before the joined one, which is dragged far.
  const added = applied({key: '0', before, coordinates: [[0, 0], [0.9, 0], [1, 5], [2, 0], [3, 0]], origins: [0, null, 1, 2, 3]}, context);
  assert.deepEqual(stepsOf(afterOf(added.edits, '1').geometry.coordinates[0]), [1, 5]);
});

test('origins are followed through a reversal, and through a change whose steps are not known', () => {
  const coordinates = line([[0, 0], [1, 0], [2, 0]]).coordinates;
  const origins = startingOrigins({coordinates});
  assert.deepEqual(originsAfter(coordinates, origins, coordinates.toReversed()), [2, 1, 0]);
  assert.deepEqual(originsAfter(coordinates, origins, line([[0, 0], [1, 1], [2, 0]]).coordinates), [0, 1, 2]);
  assert.deepEqual(originsAfter(coordinates, origins, line([[0, 0], [2, 0]]).coordinates), [0, 2]);
  assert.deepEqual(originsAfter(coordinates, origins, line([[0, 0], [1, 0], [2, 0], [3, 0]]).coordinates), [0, 1, 2, null]);
  assert.deepEqual(movedPoints({coordinates}, line([[0, 0], [2, 0]])), []);
});

test('a drawn end takes the junction and level it meets, and one taken away gets its own', () => {
  const context = contextWith({roads: [road([[0, 0], [1, 0]], {endNode: 12, endLevel: -1}), road([[4, 0], [6, 0]], {layer: '1'})]});
  const drawn = roadWithEnds({key: 'local:1', feature: road([[1, 0], [5, 0]]), before: null}, context);
  assert.deepEqual([drawn.properties.startNode, drawn.properties.startLevel], [12, -1]);
  assert.equal(drawn.properties.endLevel, 1, 'the level of the road it is put on');
  assert.match(drawn.properties.endNode, /^local:/);
  const [{feature: before}] = roadsOf(context);
  const change = {key: '0', before, coordinates: [[0, 0], [1, 1]]};
  assert.equal(applied(change, context).own.properties.endNode, 12, 'the junction moves along');
  assert.match(applied({...change, freePoints: new Set(['19.250100 42.440000'])}, context).own.properties.endNode, /^local:/);
  // Without its last point the road ends somewhere else.
  const shortened = road([[0, 0], [1, 0], [2, 0]], {endNode: 12, endLevel: 1});
  const alone = contextWith({roads: [shortened]});
  const {own} = applied({key: '0', before: shortened, coordinates: [[0, 0], [1, 0]], origins: [0, 1]}, alone);
  assert.match(own.properties.endNode, /^local:/);
  assert.equal(own.properties.endLevel, 0);
});

const ruleFor = properties => ({type: 'Feature', geometry: null, properties: {restriction: 'no_left_turn', viaNodes: [5], ...properties}});

test('a joint dragged onto a bridge or another junction takes everyone to its level and its ID, with their rules', () => {
  const first = road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const second = road([[1, 0], [1, -3]], {entityId: 'way/2', startNode: 5, startLevel: 0});
  const rule = ruleFor({from: 1, to: 2});
  const ontoBridge = contextWith({roads: [first, second, road([[2, -1], [2, 1]], {layer: '1'})], rules: [rule]});
  const change = {key: '0', before: first, coordinates: [[0, 0], [2, 0]], origins: [0, 1]};
  const bridge = applied(change, ontoBridge);
  const follower = afterOf(bridge.edits, '1').properties;
  assert.deepEqual([bridge.own.properties.endLevel, follower.startLevel], [1, 1]);
  assert.equal(follower.startNode, bridge.own.properties.endNode);
  assert.deepEqual(afterOf(bridge.edits, '2').geometry.coordinates.map(stepsOf), [[2, -1], [2, 0], [2, 1]]);
  const other = road([[2, 0], [3, 0]], {entityId: 'way/3', startNode: 30, startLevel: 0});
  const ontoJunction = contextWith({roads: [first, second, other], rules: [rule]});
  const merged = applied(change, ontoJunction);
  assert.deepEqual([merged.own.properties.endNode, afterOf(merged.edits, '1').properties.startNode], [30, 30]);
  const [ruleEdit] = merged.edits.filter(({filename}) => filename === 'turn-restrictions.json');
  assert.deepEqual(ruleEdit.after.properties.viaNodes, [30]);
});

test('a joint with a passing road is not put on another level', () => {
  const ending = road([[0, 0], [1, 0]], {endNode: 5, endLevel: 0});
  const context = contextWith({roads: [ending, road([[1, -1], [1, 0], [1, 1]]), road([[2, -1], [2, 1]], {layer: '1'})]});
  assert.match(applied({key: '0', before: ending, coordinates: [[0, 0], [2, 0]], origins: [0, 1]}, context).problem, /another level/);
});

test('a passing road stays on its level, and what ends at it stays joined to it', () => {
  const passing = road([[0, 0], [1, 0], [2, 0]], {entityId: 'way/1'});
  const ending = road([[1, 1], [1, 0]], {entityId: 'way/2', endNode: 5, endLevel: 0});
  const context = contextWith({roads: [passing, ending, road([[0, -1], [2, -1]], {layer: '1'})]});
  const change = {key: '0', before: passing, coordinates: [[0, 0], [1, -1], [2, 0]], origins: [0, 1, 2]};
  const {edits, problem} = applied(change, context);
  assert.equal(problem, null);
  const follower = afterOf(edits, '1');
  assert.deepEqual([follower.properties.endNode, follower.properties.endLevel], [5, 0]);
  assert.deepEqual(stepsOf(follower.geometry.coordinates.at(-1)), [1, -1]);
  assert.equal(afterOf(edits, '2'), undefined, 'the bridge above gets no point');
});

test('a junction moved onto a road of another level is joined to it there, and to nothing of its old level', () => {
  const ends = [road([[0, 0], [1, 0]], {endNode: 5, endLevel: 0}), road([[1, 0], [1, 1]], {startNode: 5, startLevel: 0})];
  const bridge = road([[2, -1], [2, 1]], {layer: '1'});
  const context = contextWith({roads: [...ends, bridge]});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const {edits} = junctionEdits(joint, at(2, 0), {}, context);
  assert.deepEqual(afterOf(edits, '2').geometry.coordinates.map(stepsOf), [[2, -1], [2, 0], [2, 1]]);
  assert.deepEqual([afterOf(edits, '0').properties.endLevel, afterOf(edits, '1').properties.startLevel], [1, 1]);
  // Two bridges end there, and a road on the ground passes below them.
  const high = [road([[2, 0], [3, 0]], {startNode: 30, startLevel: 1}), road([[2, 0], [3, 1]], {startNode: 30, startLevel: 1})];
  const below = contextWith({roads: [...ends, ...high, road([[2, -1], [2, 1]])]});
  const onto = junctionEdits(jointAt(at(1, 0), roadsOf(below)), at(2, 0), {}, below).edits;
  assert.equal(afterOf(onto, '0').properties.endNode, 30);
  assert.equal(afterOf(onto, '4'), undefined, 'the road below gets no point');
});

test('an end with another level chosen leaves its junction when it is dragged, and not when the level is taken back', () => {
  const first = road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const context = contextWith({roads: [first, road([[1, 0], [1, 1]], {startNode: 5, startLevel: 0})]});
  const session = {workingFeature: () => first};
  const edit = {key: '0', feature: first, extras: {}, context: {...context, session}};
  const freePoints = freePointsWithLevel('end', 1, edit);
  assert.deepEqual(freePoints, ['19.250100 42.440000']);
  assert.deepEqual(freePointsWithLevel('end', 0, {...edit, extras: {freePoints}}), []);
  const change = {key: '0', before: first, coordinates: [[0, 0], [1, -1]], origins: [0, 1], properties: {endLevel: 1}};
  const {own, edits} = applied({...change, freePoints: new Set(freePoints)}, context);
  assert.match(own.properties.endNode, /^local:/);
  assert.equal(own.properties.endLevel, 1);
  assert.deepEqual(edits, [], 'what it was joined to stays');
});

test('a level taken back does not undo a Disconnect', () => {
  const first = road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const context = contextWith({roads: [first, road([[1, 0], [1, 1]], {startNode: 5, startLevel: 0})]});
  const session = {workingFeature: () => first};
  const disconnected = '19.250100 42.440000';
  const edit = {key: '0', feature: first, extras: {disconnectedPoints: [disconnected]}, context: {...context, session}};
  const raised = freePointsWithLevel('end', 1, edit);
  assert.deepEqual(raised, [disconnected], 'the level frees the end whatever a Disconnect did');
  const lowered = freePointsWithLevel('end', 0, {...edit, extras: {...edit.extras, freePoints: raised}});
  assert.deepEqual(lowered, [], 'the point freed by the level is taken back');
  const extras = {freePoints: lowered, disconnectedPoints: [disconnected]};
  const changed = {key: '0', before: first, origins: [0, 1], extras};
  const feature = roadWithEnds({...changed, feature: {...first, geometry: line([[0, 0], [1, -1]])}}, context);
  const edits = roadBehaviors['roads.geojson'].companionEdits({...changed, feature}, context);
  assert.deepEqual(edits, [], 'the end that was disconnected still moves alone');
});

test('a line of two points is followed through a reversal', () => {
  const {coordinates} = line([[0, 0], [1, 0]]);
  assert.deepEqual(originsAfter(coordinates, [0, 1], coordinates.toReversed()), [1, 0]);
});

test('the levels of a joint that is moved are not mixed', () => {
  const low = road([[0, 0], [1, 0]], {endNode: 5, endLevel: 0});
  const high = road([[1, 0], [1, 1]], {startNode: 6, startLevel: 1});
  const context = contextWith({roads: [low, high, road([[2, 0], [2, -1]], {startNode: 30, startLevel: 0})]});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const {edits} = junctionEdits(joint, at(2, 0), {}, context);
  assert.deepEqual([afterOf(edits, '0').properties.endNode, afterOf(edits, '0').properties.endLevel], [30, 0]);
  assert.deepEqual([afterOf(edits, '1').properties.startNode, afterOf(edits, '1').properties.startLevel], [6, 1]);
});

test('turns forbidden while a junction is moved onto another, or without an ID, name the junction it has then', () => {
  const roads = [
    road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0}),
    road([[1, 0], [1, 1]], {entityId: 'way/2', startNode: 5, startLevel: 0}),
    road([[2, 0], [3, 0]], {entityId: 'way/3', startNode: 30, startLevel: 0})
  ];
  const context = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const {from, turns} = turnsAt(joint).find(group => group.from.member.entry.key === '0');
  const onto = turns.find(({to}) => to.member.entry.key === '1').to;
  const {edits} = junctionEdits(joint, at(2, 0), {[turnKey(from, onto)]: false}, context);
  const rulesOf = list => list.filter(({filename}) => filename === 'turn-restrictions.json').map(({after}) => after.properties.viaNodes);
  assert.deepEqual(rulesOf(edits), [[30]]);

  const unnamed = contextWith({roads: [road([[0, 0], [1, 0]]), road([[1, 0], [1, 1]]), road([[1, 0], [2, 0]])]});
  const bareJoint = jointAt(at(1, 0), roadsOf(unnamed));
  const group = turnsAt(bareJoint).find(({from: arm}) => arm.member.entry.key === '0');
  const choices = Object.fromEntries(group.turns.filter(({kind}) => kind !== 'uTurn').map(({to}) => [turnKey(group.from, to), false]));
  const bare = junctionEdits(bareJoint, bareJoint.coordinate, choices, unnamed).edits;
  const [first, second] = rulesOf(bare);
  assert.deepEqual(first, second);
  const nodes = ['0', '1', '2'].map(key => afterOf(bare, key).properties).map(({startNode, endNode}) => startNode ?? endNode);
  assert.deepEqual(new Set(nodes), new Set(first), 'every road ends at the junction of the rules');
});

test('without rules for junctions, joined roads only move along', () => {
  const roads = [road([[0, 0], [1, 0]]), road([[1, 0], [1, 1]]), road([[2, -1], [2, 1]], {layer: '1'})];
  const context = {...contextWith({roads}), rules: {layers: {'roads.geojson': {properties: {name: {}}}}}};
  const change = {key: '0', before: roads[0], coordinates: [[0, 0], [2, 0]], origins: [0, 1]};
  const {edits, problem} = applied(change, context);
  assert.equal(problem, null);
  for (const {after} of edits) {
    const names = Object.keys(after.properties);
    assert.deepEqual(names.filter(name => /Node|Level/.test(name)), []);
  }
  assert.deepEqual(stepsOf(afterOf(edits, '1').geometry.coordinates[0]), [2, 0]);
});

test('one rule of two roads that are split names the new halves of both', () => {
  // A road comes in, another goes out, and both pass a point where they are split.
  const incoming = road([[0, 0], [1, 0], [2, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const outgoing = road([[1, 1], [1, 0], [1, -1], [2, 0]], {entityId: 'way/2', endNode: 5, endLevel: 0});
  const context = contextWith({roads: [incoming, outgoing], rules: [ruleFor({from: 1, to: 2})]});
  const {edits, problem} = splitEdits(jointAt(at(1, 0), roadsOf(context)), context);
  assert.equal(problem, null);
  const added = edits.filter(({filename, key}) => filename === 'roads.geojson' && key.startsWith('local:')).map(({key}) => key);
  const [rule] = edits.filter(({filename}) => filename === 'turn-restrictions.json');
  assert.deepEqual(new Set([rule.after.properties.from, rule.after.properties.to]), new Set(added));
});

test('a rule of a road that leaves its junction goes, whichever way it leaves', () => {
  const first = road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const second = road([[1, 0], [1, 1]], {entityId: 'way/2', startNode: 5, startLevel: 0});
  const roads = [first, second, road([[1, 0], [2, 0]], {entityId: 'way/3', startNode: 5, startLevel: 0})];
  const rules = [ruleFor({from: 1, to: 2}), ruleFor({from: 2, to: 3}), ruleFor({from: 1, to: 1, restriction: 'no_u_turn'})];
  const context = contextWith({roads, rules});
  const deletedRules = edits => edits.filter(({filename, after}) => filename === 'turn-restrictions.json' && !after).map(({key}) => key);
  const joint = jointAt(at(1, 0), roadsOf(context));
  // In the panel, as the first road of the joint: the junction stays with the others.
  const {edits} = junctionEdits(joint, joint.coordinate, {[levelChoiceKey(joint.members[0])]: 1}, context);
  assert.deepEqual(deletedRules(edits), ['0', '2']);
  assert.deepEqual(edits.filter(({filename}) => filename === 'roads.geojson').map(({key}) => key), ['0']);
  // In the form of the road, and by disconnecting it while its points are edited.
  const raised = applied({key: '0', before: first, coordinates: [[0, 0], [1, 0]], properties: {endLevel: 1}}, context);
  assert.deepEqual(deletedRules(raised.edits), ['0', '2']);
  const freePoints = new Set(['19.250100 42.440000']);
  assert.deepEqual(deletedRules(applied({key: '0', before: first, coordinates: [[0, 0], [0.8, 0]], freePoints}, context).edits), ['0', '2']);
  // When all of them leave together, it is still the same junction.
  const choices = Object.fromEntries(joint.members.map(member => [levelChoiceKey(member), 1]));
  const together = junctionEdits(joint, joint.coordinate, choices, context).edits;
  assert.deepEqual(deletedRules(together), []);
  assert.deepEqual(new Set(together.map(({after}) => after.properties.endNode ?? after.properties.startNode)), new Set([5]));
});

test('a level and a turn chosen in one step are both recorded', () => {
  const roads = [
    road([[0, 0], [1, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0}),
    road([[1, 0], [1, 1]], {entityId: 'way/2', startNode: 5, startLevel: 0}),
    road([[1, 0], [2, 0]], {entityId: 'way/3', startNode: 5, startLevel: 0})
  ];
  const context = contextWith({roads});
  const joint = jointAt(at(1, 0), roadsOf(context));
  const {from, turns} = turnsAt(joint).find(group => group.from.member.entry.key === '0');
  const onto = key => turns.find(({to}) => to.member.entry.key === key).to;
  const choices = {
    [levelChoiceKey(joint.members[2])]: 1,
    [turnKey(from, onto('1'))]: false,
    // A turn onto the road that leaves the level is none any more.
    [turnKey(from, onto('2'))]: false
  };
  const {edits} = junctionEdits(joint, joint.coordinate, choices, context);
  assert.equal(afterOf(edits, '2').properties.startLevel, 1);
  const added = edits.filter(({filename}) => filename === 'turn-restrictions.json');
  assert.deepEqual(added.map(({after}) => [after.properties.from, after.properties.to]), [[1, 2]]);
});

test('a ring is at its junction once, stays whole, and its turns have rules', () => {
  const ring = road([[0, 0], [1, 1], [2, 0], [1, -1], [0, 0]], {
    entityId: 'way/9', junction: 'roundabout', oneway: 'yes', startNode: 5, endNode: 5, startLevel: 0, endLevel: 0
  });
  const arm = road([[-2, 0], [0, 0]], {entityId: 'way/1', endNode: 5, endLevel: 0});
  const context = contextWith({roads: [ring, arm]});
  const joint = jointAt(at(0, 0), roadsOf(context));
  assert.deepEqual(joint.members.map(({entry, isRing}) => [entry.key, isRing]), [['0', true], ['1', false]]);
  assert.match(disconnectProblem(ring, 0), /ring/);
  const {turns, from} = turnsAt(joint).find(group => group.from.member.entry.key === '1');
  assert.deepEqual(turns.map(({canRecord}) => canRecord), [true, true]);
  const {edits} = junctionEdits(joint, at(0, 0.2), {[turnKey(from, turns.at(-1).to)]: false}, context);
  const {coordinates} = afterOf(edits, '0').geometry;
  assert.deepEqual([stepsOf(coordinates[0]), stepsOf(coordinates.at(-1))], [[0, 0.2], [0, 0.2]]);
  assert.equal(roadBehaviors['roads.geojson'].marks(ring).length, 1);
});

test('a road cut by the edge of the detailed map is no dead end', () => {
  const roads = entriesFrom('roads.geojson', [road([[0, 0], [1, 0]], {entityId: 'way/1', startNode: 5, startLevel: 0})]);
  assert.deepEqual([jointAt(at(0, 0), roads).status, jointAt(at(1, 0), roads).status], ['deadEnd', 'cutOff']);
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
