// Edits of the road graph. Every one ends in a state that is whole: roads that join share one junction, and no turn rule
// names a junction that its road has left. Each function returns {edits: [{filename, key, after}], problem}.
import {insertVertex, roundedCoordinate} from './geometry-editing.js';
import {distanceMetres} from './geometry-measures.js';
import {withoutJoin} from './line-joining.js';
import {movedPoints} from './line-origins.js';
import {nodeEntryAt, restrictionFor, ruleOfTurn, rulesAfterSplit, turnKey, turnsAt} from './road-junctions.js';
import {
  canNameJunctions,
  entriesNear,
  isRing,
  jointFrom,
  levelAt,
  levelAtPlace,
  levelNameOf,
  membersAt,
  nearestToGround,
  nodeNameOf,
  nodeOf,
  nodeOfMember,
  pointKey,
  roadId
} from './road-graph.js';
import {splitRoad, withJunctionAt} from './road-shapes.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
// A point put on another road lies on it up to rounding.
const touchMetres = 0.2;
// A road passing this close has a point of its own to join.
const ownPointMetres = 0.5;

const newLocalId = () => `local:${crypto.randomUUID()}`;
const refused = problem => ({edits: [], problem});
const done = edits => ({edits, problem: null});
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);
const withProperties = (feature, properties) => ({...feature, properties: {...feature.properties, ...properties}});
const withCoordinates = (feature, coordinates) => ({...feature, geometry: {...feature.geometry, coordinates}});

// Several changes of one object, such as a rule that two split roads share, add up to one edit.
class Changes {
  #filename;
  #changed = new Map();

  constructor(filename) {
    this.#filename = filename;
  }

  afterOf({key, feature}) {
    return this.#changed.has(key) ? this.#changed.get(key).after : feature;
  }

  change(entry, change) {
    const after = this.afterOf(entry);
    if (after) this.#changed.set(entry.key, {entry, after: change(after)});
  }

  // Whatever was changed before stands.
  changeIfUntouched(entry, change) {
    if (!this.#changed.has(entry.key)) this.change(entry, change);
  }

  // The objects that are not what they were: [{entry, after}].
  list() {
    return [...this.#changed.values()].filter(({entry, after}) => !isSameJSON(entry.feature, after));
  }

  edits() {
    return this.list().map(({entry: {key}, after}) => ({filename: this.#filename, key, after}));
  }
}

const endsOfMember = ({end, isRing: isRingEnd}) => {
  if (isRingEnd) return ['start', 'end'];
  return end ? [end] : [];
};

// Changes of roads. Older rules know no junctions of the editor, so there roads only share their points.
class RoadChanges extends Changes {
  constructor({rules}) {
    super(roadsFile);
    this.canNameJunctions = canNameJunctions(rules);
  }
}

// The roads that end at a joint on one level end at one junction.
function shareJunction(roads, members, level, node) {
  if (!roads.canNameJunctions) return;
  for (const member of members) {
    const facts = endsOfMember(member).flatMap(end => [[nodeNameOf(end), node], [levelNameOf(end), level]]);
    if (facts.length > 0) roads.change(member.entry, feature => withProperties(feature, Object.fromEntries(facts)));
  }
}

const withPointMoved = (feature, from, to) =>
  withCoordinates(
    feature,
    feature.geometry.coordinates.map(point => (pointKey(point) === pointKey(from) ? to : point))
  );

const endNodes = ({properties}) => [properties.startNode, properties.endNode];

// The junction a road ends at now in place of one it ended at before, or undefined when it left it.
function junctionInPlaceOf(node, before, after) {
  if (endNodes(after).includes(node)) return node;
  const index = endNodes(before).indexOf(node);
  return endNodes(after)[index];
}

// What becomes of the turn rules when roads change their junctions. A rule goes where both of its roads went, and one
// whose road left the junction is gone.
function rulesFollowing(changedRoads, context, rules = new Changes(restrictionsFile)) {
  const roadsById = Map.groupBy(changedRoads.filter(({after}) => after), ({entry}) => roadId(entry));
  if (roadsById.size === 0) return rules;
  const junctionOf = (id, node) => {
    const road = (roadsById.get(id) ?? []).find(({entry}) => endNodes(entry.feature).includes(node));
    return road ? junctionInPlaceOf(node, road.entry.feature, road.after) : node;
  };
  for (const entry of context.entriesOf(restrictionsFile)) {
    const {from, to, viaNodes = []} = entry.feature.properties;
    if (viaNodes.length !== 1 || (!roadsById.has(from) && !roadsById.has(to))) continue;
    const [node] = viaNodes;
    const [fromNode, toNode] = [junctionOf(from, node), junctionOf(to, node)];
    if (fromNode === node && toNode === node) continue;
    const isMovedTogether = fromNode === toNode && isSameJunctionElsewhere(node, fromNode, changedRoads);
    rules.changeIfUntouched(entry, rule => (isMovedTogether ? withProperties(rule, {viaNodes: [fromNode]}) : null));
  }
  return rules;
}

// Whether a junction is the one that another was: several roads went there, or it is one that was there already. A road
// alone at an end of its own has nothing left to turn onto.
function isSameJunctionElsewhere(previousNode, node, changedRoads) {
  const arrived = changedRoads.filter(
    ({entry, after}) =>
      endNodes(entry.feature).includes(previousNode) && junctionInPlaceOf(previousNode, entry.feature, after) === node
  );
  return arrived.length > 1 || Number.isInteger(node);
}

// Everything of a change of roads, with the rules that follow from it.
function withRules(roads, context, rules) {
  return done([...roads.edits(), ...rulesFollowing(roads.list(), context, rules).edits()]);
}

// Takes one road out of a joint. An end gets a junction of its own.
export function disconnectedRoad(feature, index) {
  const geometry = withoutJoin(feature.geometry, index);
  if (!geometry) return null;
  const isInner = geometry.coordinates.length < feature.geometry.coordinates.length;
  if (isInner) return {...feature, geometry};
  const end = index === 0 ? 'start' : 'end';
  return withProperties({...feature, geometry}, {[nodeNameOf(end)]: newLocalId(), [levelNameOf(end)]: levelAt(feature, index)});
}

const ringProblem = 'A ring has no end to pull back here. Disconnect the other roads instead.';
const shortProblem = 'This road is too short to be pulled back.';

// Why a road cannot be taken out of a joint at this point, or null.
export function disconnectProblem(feature, index) {
  if (isRing(feature) && (index === 0 || index === feature.geometry.coordinates.length - 1)) return ringProblem;
  return withoutJoin(feature.geometry, index) ? null : shortProblem;
}

export function disconnectEdits(member, context) {
  const {entry, index} = member;
  const problem = disconnectProblem(entry.feature, index);
  if (problem) return refused(problem);
  const roads = new RoadChanges(context);
  roads.change(entry, feature => disconnectedRoad(feature, index));
  return withRules(roads, context);
}

// Puts every road of a joint on one level. A road that passes decides, because its level is that of the road itself.
function joinLevels({members}, context) {
  const passingLevels = [...new Set(members.filter(({end}) => !end).map(({level}) => level))];
  if (passingLevels.length > 1) {
    return refused('Roads pass here on different levels. Split one here, or change its layer, bridge or tunnel.');
  }
  const level = passingLevels[0] ?? nearestToGround(members.map(member => member.level));
  const roads = new RoadChanges(context);
  shareJunction(roads, members, level, nodeOf(members) ?? newLocalId());
  return withRules(roads, context);
}

function withPointAt(feature, coordinate, segmentIndex) {
  const geometry = insertVertex(feature.geometry, {vertexIndex: segmentIndex});
  return withCoordinates(feature, geometry.coordinates.with(segmentIndex + 1, coordinate));
}

// Moves an end onto the road it nearly meets, at a point of that road if there is one close by.
function joinNearMiss({coordinate, members, missed}, context) {
  const {coordinates} = missed.entry.feature.geometry;
  const known = coordinates.find(point => distanceMetres(point, missed.coordinate) <= ownPointMetres);
  const meeting = known ?? roundedCoordinate(missed.coordinate);
  const roads = new RoadChanges(context);
  if (!known) roads.change(missed.entry, feature => withPointAt(feature, meeting, missed.segmentIndex));
  const {problem} = moveMembers(roads, members, {from: coordinate, to: meeting}, context);
  return problem ? refused(problem) : withRules(roads, context);
}

function joinCrossing({coordinate, roads: [first, second], segments}, context) {
  const meeting = roundedCoordinate(coordinate);
  const roads = new RoadChanges(context);
  roads.change(first, feature => withPointAt(feature, meeting, segments.segmentIndex));
  roads.change(second, feature => withPointAt(feature, meeting, segments.otherSegmentIndex));
  return withRules(roads, context);
}

const joinByStatus = {apart: joinLevels, near: joinNearMiss, crossing: joinCrossing};

// Joins what touches, nearly touches or crosses here without being joined.
export const joinEdits = (joint, context) => joinByStatus[joint.status](joint, context);

// What roads put on a place meet there: [{level, node, members}]. A road that only passes has no junction there yet.
function meetingsAt(coordinate, roads, exceptKeys) {
  const joint = jointFrom(membersAt(coordinate, roads, exceptKeys));
  if (joint) return joint.groups.map(({level, members}) => ({level, node: nodeOf(members), members}));
  return entriesNear(coordinate, roads)
    .filter(({key, feature}) => !exceptKeys.has(key) && withJunctionAt(feature, coordinate, touchMetres) !== null)
    .map(({feature}) => ({level: levelAtPlace(feature, coordinate), node: null, members: []}));
}

// Which of them a road joins: the one on its own level, then on the shown one, then the one nearest to the ground.
function chosenMeeting(meetings, levels) {
  const level = levels.find(candidate => meetings.some(meeting => meeting.level === candidate));
  const chosenLevel = level ?? nearestToGround(meetings.map(meeting => meeting.level));
  const chosen = meetings.filter(meeting => meeting.level === chosenLevel);
  return chosen.find(({node}) => node !== null) ?? chosen[0];
}

const levelProblem = 'A road passes here on another level, so these cannot be joined. Disconnect it first.';

// Moves the roads of one level of a joint to a place, and joins them to what is there. keepsLevel when something else of
// the joint cannot leave its level, so only what is on that level is joined. Returns
// {problem} when that cannot be, otherwise {level}, the one they are on then.
function moveMembers(roads, members, {from, to, facts = null, exceptKeys = new Set(), keepsLevel = false}, context) {
  for (const {entry} of members) roads.change(entry, feature => withPointMoved(feature, from, to));
  const [{level}] = members;
  const moving = new Set([...exceptKeys, ...members.map(({entry}) => entry.key)]);
  const joined = facts ?? joinedFacts(to, {level, node: nodeOf(members), keepsLevel}, context, moving);
  if (!joined || !roads.canNameJunctions) return {level};
  const isPassingElsewhere = members.some(member => !member.end && member.level !== joined.level);
  if (isPassingElsewhere) return {problem: levelProblem};
  shareJunction(roads, members, joined.level, joined.node);
  shareJunction(roads, (joined.members ?? []).filter(member => nodeOfMember(member) === undefined), joined.level, joined.node);
  return {level: joined.level};
}

// The junction that roads coming to a place get there, or null where they meet nothing.
function joinedFacts(coordinate, {level, node, keepsLevel = false}, context, exceptKeys) {
  const everyMeeting = meetingsAt(coordinate, context.entriesOf(roadsFile), exceptKeys);
  const meetings = keepsLevel ? everyMeeting.filter(meeting => meeting.level === level) : everyMeeting;
  if (meetings.length === 0) return null;
  const chosen = chosenMeeting(meetings, [level, context.shownLevel?.() ?? null]);
  return {level: chosen.level, node: chosen.node ?? node ?? newLocalId(), members: chosen.members};
}

// The other roads that get a point at a place, because roads of this level now touch them there.
function touchRoads(roads, coordinate, level, context, exceptKeys) {
  for (const entry of entriesNear(coordinate, context.entriesOf(roadsFile))) {
    if (exceptKeys.has(entry.key)) continue;
    const isTouched = withJunctionAt(entry.feature, coordinate, touchMetres) !== null;
    if (!isTouched || levelAtPlace(entry.feature, coordinate) !== level) continue;
    roads.change(entry, feature => withJunctionAt(feature, coordinate, touchMetres) ?? feature);
  }
}

function movedFurniture(from, to, context) {
  const node = nodeEntryAt(context.entriesOf(nodesFile), from);
  if (!node) return [];
  return [{filename: nodesFile, key: node.key, after: {...node.feature, geometry: {...node.feature.geometry, coordinates: to}}}];
}

// Ends every road that passes here, so that its turns can have rules. One step.
export function splitEdits(joint, context) {
  const roads = new RoadChanges(context);
  const rules = new Changes(restrictionsFile);
  const propertyRules = context.rules.layers[roadsFile].properties;
  const added = [];
  for (const {level, members} of joint.groups) {
    const node = nodeOf(members) ?? newLocalId();
    shareJunction(roads, members, level, node);
    const passing = members.filter(({end}) => !end);
    if (new Set(passing.map(({entry}) => entry.key)).size < passing.length) {
      return refused('A road passes here twice. Split it in Edit points instead.');
    }
    for (const {entry, index} of passing) {
      const key = newLocalId();
      const {edits, problem} = rulesAfterSplit(context.entriesOf(restrictionsFile), entry, key);
      if (problem) return refused(problem);
      for (const {entry: rule, renamed} of edits) rules.change(rule, feature => withProperties(feature, renamed(feature.properties)));
      const [first, second] = splitRoad(roads.afterOf(entry), index, propertyRules, {node, level});
      roads.change(entry, () => first);
      added.push({filename: roadsFile, key, after: second});
    }
  }
  return done([...roads.edits(), ...added, ...rules.edits()]);
}

function furnitureEdit(coordinate, kind, context) {
  const known = nodeEntryAt(context.entriesOf(nodesFile), coordinate);
  if ((known?.feature.properties.kind ?? '') === kind) return [];
  if (!kind) return [{filename: nodesFile, key: known.key, after: null}];
  if (known) {
    const {crossing, traffic_signals: signals, ...kept} = known.feature.properties;
    const ownFacts = {crossing: {crossing}, traffic_signals: {traffic_signals: signals}}[kind] ?? {};
    const stated = Object.fromEntries(Object.entries(ownFacts).filter(([, value]) => value !== undefined));
    return [{filename: nodesFile, key: known.key, after: {...known.feature, properties: {...kept, ...stated, kind}}}];
  }
  const geometry = {type: 'Point', coordinates: coordinate};
  return [{filename: nodesFile, key: newLocalId(), after: {type: 'Feature', properties: {kind}, geometry}}];
}

export const levelChoiceKey = ({entry, index}) => `level:${entry.key}/${index}`;

// The members of a joint on the levels chosen for them.
const withChosenLevels = (joint, choices) =>
  joint.members.map(member => ({...member, level: choices[levelChoiceKey(member)] ?? member.level, previousLevel: member.level}));

// Which junction ID belongs to which level once some roads changed theirs: it stays with those that stayed, and goes along
// only when every road of it went to one level.
function nodesByLevel(members) {
  const owned = new Map();
  const byNode = Map.groupBy(members.filter(member => nodeOfMember(member) !== undefined), nodeOfMember);
  for (const [node, holders] of byNode) {
    const stayed = holders.filter(({level, previousLevel}) => level === previousLevel);
    const {level} = stayed[0] ?? holders[0];
    const isKeptAlready = Number.isInteger(owned.get(level)) || (owned.has(level) && !Number.isInteger(node));
    if (!isKeptAlready) owned.set(level, node);
  }
  return owned;
}

function applyLevelChoices(roads, members) {
  const owned = nodesByLevel(members);
  for (const [level, group] of Map.groupBy(members, member => member.level)) {
    const hasMoved = group.some(member => member.level !== member.previousLevel);
    if (hasMoved) shareJunction(roads, group, level, owned.get(level) ?? newLocalId());
  }
}

// The joint as the open edit leaves it, for its turns: on other levels other roads meet.
export function jointWithChoices(joint, choices, context) {
  const roads = new RoadChanges(context);
  applyLevelChoices(roads, withChosenLevels(joint, choices));
  return jointAfter(joint, roads);
}

// The same members with their roads as they are after the changes. They may have moved, so they stay by their positions.
const jointAfter = (joint, roads) =>
  jointFrom(
    joint.members.map(member => {
      const feature = roads.afterOf(member.entry);
      return {...member, entry: {...member.entry, feature}, level: levelAt(feature, member.index)};
    })
  );

// What was chosen about the turns of a joint. A junction without an ID gets one for its first rule.
function applyTurnChoices(roads, rules, joint, choices, context) {
  const restrictions = context.entriesOf(restrictionsFile);
  const added = [];
  for (const {from, members, turns} of turnsAt(joint)) {
    for (const {to, kind, canRecord} of turns) {
      const isAllowed = choices[turnKey(from, to)];
      if (isAllowed === undefined || !canRecord) continue;
      const {recorded, onlyRule} = ruleOfTurn(restrictions, from, to, members);
      if (onlyRule || Boolean(recorded) === !isAllowed) continue;
      if (recorded) {
        rules.change(recorded, () => null);
        continue;
      }
      nameJunction(roads, members);
      added.push({restriction: restrictionFor(kind), from: from.member, to: to.member});
    }
  }
  return added;
}

// The roads of one level get a junction ID, unless they have one or got one for another rule.
function nameJunction(roads, members) {
  const current = members.map(member => ({...member, entry: {...member.entry, feature: roads.afterOf(member.entry)}}));
  const node = nodeOf(current) ?? newLocalId();
  for (const member of members) shareJunction(roads, [member], member.level, node);
}

// The added rules, at the junction where their roads are once everything is moved.
function addedRuleEdits(added, roads) {
  return added.map(({restriction, from, to}) => {
    const node = roads.afterOf(from.entry).properties[nodeNameOf(from.end)];
    const properties = {restriction, from: roadId(from.entry), to: roadId(to.entry), viaNodes: [node]};
    return {filename: restrictionsFile, key: newLocalId(), after: {type: 'Feature', properties, geometry: null}};
  });
}

// Everything one Apply of a junction records: levels, lights, turns and its place.
export function junctionEdits(joint, coordinate, choices, context) {
  const roads = new RoadChanges(context);
  const rules = new Changes(restrictionsFile);
  applyLevelChoices(roads, withChosenLevels(joint, choices));
  const chosen = jointAfter(joint, roads);
  const addedRules = applyTurnChoices(roads, rules, chosen, choices, context);
  const kind = choices.furniture ?? nodeEntryAt(context.entriesOf(nodesFile), joint.coordinate)?.feature.properties.kind ?? '';
  const furniture = furnitureEdit(joint.coordinate, kind, context);
  const isMoved = pointKey(coordinate) !== pointKey(joint.coordinate);
  const everyEdit = moved => done([...withRules(roads, context, rules).edits, ...addedRuleEdits(addedRules, roads), ...moved]);
  if (!isMoved) return everyEdit(furniture);
  const place = roundedCoordinate(coordinate);
  const problem = moveJoint(roads, chosen, place, context);
  if (problem) return refused(problem);
  return everyEdit(furnitureAt(joint.coordinate, place, furniture, context));
}

function moveJoint(roads, joint, to, context) {
  const exceptKeys = new Set(joint.members.map(({entry}) => entry.key));
  for (const {members} of joint.groups) {
    const keepsLevel = joint.groups.length > 1;
    const {problem, level} = moveMembers(roads, members, {from: joint.coordinate, to, exceptKeys, keepsLevel}, context);
    if (problem) return problem;
    touchRoads(roads, to, level, context, exceptKeys);
  }
  return null;
}

// What stands on a junction goes with it, whether it was there before or is put up in the same step.
function furnitureAt(from, to, furniture, context) {
  const [edit] = furniture.length > 0 ? furniture : movedFurniture(from, to, context);
  if (!edit?.after) return furniture;
  return [{...edit, after: {...edit.after, geometry: {...edit.after.geometry, coordinates: to}}}];
}

// --- A road that is drawn or reshaped

const isFree = (point, {freePoints = new Set()}) => freePoints.has(pointKey(point));

// The roads that move along with a point of the edited one.
function membersAlong({from, index}, {key, before}, context) {
  const level = levelAt(before, index);
  return membersAt(from, context.entriesOf(roadsFile), new Set([key])).filter(member => member.level === level);
}

// The points the edit moved, each place once: a ring is twice where it begins.
function movesOf({before, feature, origins}) {
  if (!before) return [];
  const moves = movedPoints(before.geometry, feature.geometry, origins ?? undefined);
  const seen = new Set();
  return moves.filter(({from}) => !seen.has(pointKey(from)) && seen.add(pointKey(from)));
}

// The junction and level of one end of the road, or nothing where they stay as they are.
function endFacts(end, edit, context) {
  const {key, feature, before} = edit;
  const coordinate = feature.geometry.coordinates.at(end === 'start' ? 0 : -1);
  const previous = before?.geometry.coordinates.at(end === 'start' ? 0 : -1);
  const levelName = levelNameOf(end);
  const nodeName = nodeNameOf(end);
  const isSameEnd = previous !== undefined && isOriginOf(end, edit);
  const level = feature.properties[levelName] ?? (before ? levelAt(before, end === 'start' ? 0 : before.geometry.coordinates.length - 1) : null);
  if (isSameEnd && pointKey(previous) === pointKey(coordinate)) return levelFacts(end, level ?? 0, edit, context);
  const isTakenAlong = isSameEnd && !isFree(previous, edit);
  const origin = before && {from: previous, index: end === 'start' ? 0 : before.geometry.coordinates.length - 1};
  const along = isTakenAlong ? membersAlong(origin, edit, context) : [];
  const ownNode = isTakenAlong ? before.properties[nodeName] : undefined;
  const exceptKeys = new Set([key, ...along.map(({entry}) => entry.key)]);
  const ownLevel = isSameEnd ? level : levelOfNewEnd(end, edit);
  const joined = joinedFacts(coordinate, {level: ownLevel, node: ownNode}, context, exceptKeys);
  if (joined) return {[nodeName]: joined.node, [levelName]: joined.level};
  return {[nodeName]: ownNode ?? newLocalId(), [levelName]: ownLevel ?? context.shownLevel?.() ?? 0};
}

// Whether an end of the road is the point that was this end before, and not one that became it.
function isOriginOf(end, {before, feature, origins}) {
  if (!origins) return true;
  const origin = origins.at(end === 'start' ? 0 : -1);
  return origin === (end === 'start' ? 0 : before.geometry.coordinates.length - 1) && feature.geometry.coordinates.length > 1;
}

// A point inside the road that became its end is where the road was there.
function levelOfNewEnd(end, {before, feature, origins}) {
  const origin = origins?.at(end === 'start' ? 0 : -1);
  if (before && Number.isInteger(origin)) return levelAt(before, origin);
  return feature.properties[levelNameOf(end)] ?? null;
}

// An end that was put on another level leaves its junction for the one that roads of that level share there.
function levelFacts(end, level, {key, feature, before}, context) {
  if (level === (before.properties[levelNameOf(end)] ?? 0)) return {};
  const coordinate = feature.geometry.coordinates.at(end === 'start' ? 0 : -1);
  const meetings = meetingsAt(coordinate, context.entriesOf(roadsFile), new Set([key]));
  const node = meetings.find(meeting => meeting.level === level)?.node ?? newLocalId();
  return {[levelNameOf(end)]: level, [nodeNameOf(end)]: node};
}

// A drawn or reshaped road with the junctions and levels of what its ends meet.
export function roadWithEnds(edit, context) {
  const start = endFacts('start', edit, context);
  // A ring starts and ends at one junction.
  const end = isRing(edit.feature)
    ? Object.fromEntries(Object.entries(start).map(([name, value]) => [name.replace('start', 'end'), value]))
    : endFacts('end', edit, context);
  return withProperties(edit.feature, {...start, ...end});
}

const nextMember = ({feature}, nextIndex) => {
  const {length} = feature.geometry.coordinates;
  return {level: levelAt(feature, nextIndex), end: nextIndex === 0 ? 'start' : nextIndex === length - 1 ? 'end' : null};
};

// What goes with a road as Apply records it: the roads joined to its moved points with what stands there, the roads it now
// touches, and the turn rules of all of them.
export function companionsOfRoad(edit, context) {
  const {key, feature, before} = edit;
  const roads = new RoadChanges(context);
  const furniture = [];
  const movedIndexes = new Set();
  for (const move of movesOf(edit)) {
    movedIndexes.add(move.nextIndex);
    if (isFree(move.from, edit)) continue;
    furniture.push(...movedFurniture(move.from, move.to, context));
    const along = membersAlong(move, edit, context);
    if (along.length === 0) continue;
    const {level, end} = nextMember(edit, move.nextIndex);
    // The edited road has its place in the junction already, and the others share it.
    const facts = end ? {level, node: feature.properties[nodeNameOf(end)]} : null;
    const {problem} = moveMembers(roads, along, {...move, facts, exceptKeys: new Set([key]), keepsLevel: !end}, context);
    if (problem) return refused(problem);
  }
  const known = new Set((before?.geometry.coordinates ?? []).map(pointKey));
  feature.geometry.coordinates.forEach((point, index) => {
    if (known.has(pointKey(point)) && !movedIndexes.has(index)) return;
    touchRoads(roads, point, levelAt(feature, index), context, new Set([key]));
  });
  const ownChange = before ? [{entry: {filename: roadsFile, key, feature: before}, after: feature}] : [];
  const rules = rulesFollowing([...ownChange, ...roads.list()], context);
  return done([...roads.edits(), ...rules.edits(), ...furniture]);
}
