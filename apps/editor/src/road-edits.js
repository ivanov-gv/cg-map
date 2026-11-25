// Edits of the road graph, as pure changes of the roads that meet at a joint. Every function returns
// {edits: [{filename, key, after}], problem}.
import {insertVertex, removeVertex, roundedCoordinate} from './geometry-editing.js';
import {coordinateAtOffset, distanceMetres, metricOffset} from './geometry-measures.js';
import {nodeEntryAt, restrictionFor, ruleOfTurn, rulesAfterSplit, turnKey, turnsAt} from './road-junctions.js';
import {
  entriesNear,
  jointAt,
  levelAt,
  levelAtPlace,
  levelNameOf,
  nearestToGround,
  nodeNameOf,
  nodeOf,
  pointKey,
  roadId
} from './road-graph.js';
import {splitRoad, withJunctionAt} from './road-shapes.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
// How far a disconnected end is pulled back along its road, so that nobody reads it as joined.
const pulledBackMetres = 1.5;
// A point put on another road lies on it up to rounding.
const touchMetres = 0.2;

const newLocalId = () => `local:${crypto.randomUUID()}`;
const refused = problem => ({edits: [], problem});
const withProperties = (feature, properties) => ({...feature, properties: {...feature.properties, ...properties}});
const withCoordinates = (feature, coordinates) => ({...feature, geometry: {...feature.geometry, coordinates}});

// Several changes of one road, such as a ring that meets itself, add up to one edit.
class RoadChanges {
  #changed = new Map();

  change({key, feature}, change) {
    this.#changed.set(key, change(this.#changed.get(key) ?? feature));
  }

  edits() {
    return [...this.#changed].map(([key, after]) => ({filename: roadsFile, key, after}));
  }
}

// The roads that end at a joint on one level end at one junction.
function shareJunction(changes, members, level, node) {
  for (const {entry, end} of members) {
    if (!end) continue;
    changes.change(entry, feature => withProperties(feature, {[nodeNameOf(end)]: node, [levelNameOf(end)]: level}));
  }
}

const withPointMoved = (feature, from, to) =>
  withCoordinates(
    feature,
    feature.geometry.coordinates.map(point => (pointKey(point) === pointKey(from) ? to : point))
  );

// The pulled back end of a road, or null when the road is too short to have one.
function pulledBack(feature, end) {
  const {coordinates} = feature.geometry;
  const [last, before] = end === 'end' ? [coordinates.at(-1), coordinates.at(-2)] : [coordinates[0], coordinates[1]];
  const length = distanceMetres(last, before);
  if (length === 0) return null;
  const [east, north] = metricOffset(before, last);
  const fraction = Math.min(pulledBackMetres / length, 0.5);
  return roundedCoordinate(coordinateAtOffset([east * fraction, north * fraction], last));
}

// Takes one road out of a joint: an end is pulled back a little, and a road that passes goes on without the point.
export function disconnectedRoad(feature, index) {
  const {coordinates} = feature.geometry;
  const isInner = index > 0 && index < coordinates.length - 1;
  if (isInner) return {...feature, geometry: removeVertex(feature.geometry, {vertexIndex: index})};
  const end = index === 0 ? 'start' : 'end';
  const coordinate = pulledBack(feature, end);
  if (!coordinate) return null;
  const moved = withCoordinates(feature, coordinates.with(index, coordinate));
  return withProperties(moved, {[nodeNameOf(end)]: newLocalId(), [levelNameOf(end)]: levelAt(feature, index)});
}

// A rule at a joint that its road leaves would name a turn that is gone.
function rulesLeftBehind(member, {groups}, context) {
  const group = groups.find(({members}) => members.includes(member));
  const node = nodeOf(group.members);
  const id = roadId(member.entry);
  return context
    .entriesOf(restrictionsFile)
    .filter(({feature: {properties}}) => properties.viaNodes?.includes(node) && [properties.from, properties.to].includes(id))
    .map(({filename, key}) => ({filename, key, after: null}));
}

export function disconnectEdits(joint, member, context) {
  const after = disconnectedRoad(member.entry.feature, member.index);
  if (!after) return refused('This road is too short to be pulled back.');
  return {edits: [{filename: roadsFile, key: member.entry.key, after}, ...rulesLeftBehind(member, joint, context)], problem: null};
}

// Puts every road of a joint on one level. A road that passes decides, because its level is that of the road itself.
function joinLevels({members}) {
  const passingLevels = [...new Set(members.filter(({end}) => !end).map(({level}) => level))];
  if (passingLevels.length > 1) {
    return refused('Roads pass here on different levels. Split one here, or change its layer, bridge or tunnel.');
  }
  const level = passingLevels[0] ?? nearestToGround(members.map(member => member.level));
  const changes = new RoadChanges();
  shareJunction(changes, members, level, nodeOf(members) ?? newLocalId());
  return {edits: changes.edits(), problem: null};
}

const isWithinMetres = (first, second, metres) => distanceMetres(first, second) <= metres;

function withPointAt(feature, coordinate, segmentIndex) {
  const geometry = insertVertex(feature.geometry, {vertexIndex: segmentIndex});
  return withCoordinates(feature, geometry.coordinates.with(segmentIndex + 1, coordinate));
}

// Moves an end onto the road it nearly meets, at a point of that road if there is one close by.
function joinNearMiss({members: [member], missed}) {
  const {entry, coordinate, segmentIndex, level} = missed;
  const known = entry.feature.geometry.coordinates.find(point => isWithinMetres(point, coordinate, 0.5));
  const meeting = known ?? roundedCoordinate(coordinate);
  const changes = new RoadChanges();
  changes.change(member.entry, feature => withCoordinates(feature, feature.geometry.coordinates.with(member.index, meeting)));
  if (!known) changes.change(entry, feature => withPointAt(feature, meeting, segmentIndex));
  const otherEnd = [[0, 'start'], [-1, 'end']].find(([index]) => pointKey(entry.feature.geometry.coordinates.at(index)) === pointKey(meeting));
  const otherMember = otherEnd ? [{entry, end: otherEnd[1]}] : [];
  const meetingMembers = [...otherMember, {entry: member.entry, end: member.end}];
  shareJunction(changes, meetingMembers, level, nodeOf(meetingMembers) ?? newLocalId());
  return {edits: changes.edits(), problem: null};
}

function joinCrossing({coordinate, roads: [first, second], segments}) {
  const meeting = roundedCoordinate(coordinate);
  const changes = new RoadChanges();
  changes.change(first, feature => withPointAt(feature, meeting, segments.segmentIndex));
  changes.change(second, feature => withPointAt(feature, meeting, segments.otherSegmentIndex));
  return {edits: changes.edits(), problem: null};
}

const joinByStatus = {apart: joinLevels, near: joinNearMiss, crossing: joinCrossing};

// Joins what touches, nearly touches or crosses here without being joined.
export const joinEdits = joint => joinByStatus[joint.status](joint);

// Ends every road that passes here, so that its turns can have rules. One step.
export function splitEdits(joint, context) {
  const restrictions = context.entriesOf(restrictionsFile);
  const propertyRules = context.rules.layers[roadsFile].properties;
  const edits = [];
  for (const {level, members} of joint.groups) {
    const node = nodeOf(members) ?? newLocalId();
    const changes = new RoadChanges();
    shareJunction(changes, members, level, node);
    for (const {entry, index} of members.filter(({end}) => !end)) {
      const secondKey = newLocalId();
      const {edits: ruleEdits, problem} = rulesAfterSplit(restrictions, entry, secondKey);
      if (problem) return refused(problem);
      const [first, second] = splitRoad(entry.feature, index, propertyRules, {node, level});
      edits.push({filename: roadsFile, key: entry.key, after: first}, {filename: roadsFile, key: secondKey, after: second}, ...ruleEdits);
    }
    edits.push(...changes.edits());
  }
  const keys = edits.map(({filename, key}) => `${filename}:${key}`);
  if (new Set(keys).size < keys.length) return refused('A road passes here twice. Split it in Edit points instead.');
  return {edits, problem: null};
}

function furnitureEdit(coordinate, kind, context) {
  const known = nodeEntryAt(context.entriesOf(nodesFile), coordinate);
  if ((known?.feature.properties.kind ?? '') === kind) return [];
  if (!kind) return [{filename: nodesFile, key: known.key, after: null}];
  if (known) {
    const {crossing, traffic_signals: signals, ...kept} = known.feature.properties;
    const isCrossing = kind === 'crossing';
    const facts = {...(isCrossing && crossing ? {crossing} : {}), ...(kind === 'traffic_signals' && signals ? {traffic_signals: signals} : {})};
    return [{filename: nodesFile, key: known.key, after: {...known.feature, properties: {...kept, ...facts, kind}}}];
  }
  const geometry = {type: 'Point', coordinates: coordinate};
  return [{filename: nodesFile, key: newLocalId(), after: {type: 'Feature', properties: {kind}, geometry}}];
}

function turnEdit({from, to, kind, members, isForbidden, node}, restrictions) {
  const {recorded, onlyRule} = ruleOfTurn(restrictions, from, to, members);
  if (onlyRule || Boolean(recorded) === isForbidden) return [];
  if (recorded) return [{filename: restrictionsFile, key: recorded.key, after: null}];
  const ends = {from: roadId(from.member.entry), to: roadId(to.member.entry)};
  const properties = {restriction: restrictionFor(kind), ...ends, viaNodes: [node]};
  return [{filename: restrictionsFile, key: newLocalId(), after: {type: 'Feature', properties, geometry: null}}];
}

// What was chosen about the turns of a joint. A junction without an ID gets one for its first rule.
function turnChoiceEdits(joint, choices, context, changes) {
  const restrictions = context.entriesOf(restrictionsFile);
  const nodeByLevel = new Map();
  return turnsAt(joint).flatMap(({from, members, turns}) =>
    turns.flatMap(({to, kind, canRecord}) => {
      const isAllowed = choices[turnKey(from, to)];
      if (isAllowed === undefined || !canRecord) return [];
      const {level} = from.member;
      if (!nodeByLevel.has(level)) nodeByLevel.set(level, nodeOf(members) ?? newLocalId());
      const node = nodeByLevel.get(level);
      const edits = turnEdit({from, to, kind, members, isForbidden: !isAllowed, node}, restrictions);
      if (edits.some(({after}) => after)) shareJunction(changes, members, level, node);
      return edits;
    })
  );
}

export const levelChoiceKey = ({entry, end}) => `level:${entry.key}/${end}`;

// Ends that came to a level nobody else has there leave the junction, and those that met another one share its ID.
function levelChoiceEdits(joint, choices, changes) {
  const chosen = joint.members.map(member => ({...member, level: choices[levelChoiceKey(member)] ?? member.level}));
  if (chosen.every(({level}, index) => level === joint.members[index].level)) return;
  const usedNodes = new Set();
  for (const [level, members] of Map.groupBy(chosen, member => member.level)) {
    const known = nodeOf(members);
    const node = known !== null && !usedNodes.has(known) ? known : newLocalId();
    usedNodes.add(node);
    shareJunction(changes, members, level, node);
  }
}

// Everything one Apply of a junction records: levels, lights, turns and its place.
export function junctionEdits(joint, coordinate, choices, context) {
  const changes = new RoadChanges();
  levelChoiceEdits(joint, choices, changes);
  const turnEdits = turnChoiceEdits(joint, choices, context, changes);
  const isMoved = pointKey(coordinate) !== pointKey(joint.coordinate);
  const place = isMoved ? roundedCoordinate(coordinate) : joint.coordinate;
  if (isMoved) for (const {entry} of joint.members) changes.change(entry, feature => withPointMoved(feature, joint.coordinate, place));
  const known = nodeEntryAt(context.entriesOf(nodesFile), joint.coordinate);
  const kind = choices.furniture ?? known?.feature.properties.kind ?? '';
  let nodeEdits = furnitureEdit(joint.coordinate, kind, context);
  if (isMoved && kind) {
    const after = nodeEdits[0]?.after ?? known.feature;
    const key = nodeEdits[0]?.key ?? known.key;
    nodeEdits = [{filename: nodesFile, key, after: {...after, geometry: {...after.geometry, coordinates: place}}}];
  }
  return [...changes.edits(), ...turnEdits, ...nodeEdits];
}

// The points that a road has before and after, as pairs of their positions, in order.
function keptPoints(previousKeys, nextKeys) {
  const kept = [];
  let from = 0;
  previousKeys.forEach((key, index) => {
    const nextIndex = nextKeys.indexOf(key, from);
    if (nextIndex < 0) return;
    kept.push([index, nextIndex]);
    from = nextIndex + 1;
  });
  return kept;
}

const nearestTo = (point, candidates) =>
  candidates.reduce((nearest, candidate) =>
    distanceMetres(candidate, point) < distanceMetres(nearest, point) ? candidate : nearest
  );

// The points of a road that an edit moved, each with where it went. Between points that stayed, as many points as before
// are the same ones moved; among more or fewer, a point went to the nearest. A point that was taken out moved nowhere.
export function movedPoints(before, after) {
  const previous = before.geometry.coordinates;
  const next = after.geometry.coordinates;
  const kept = keptPoints(previous.map(pointKey), next.map(pointKey));
  const anchors = [[-1, -1], ...kept, [previous.length, next.length]];
  return anchors.slice(1).flatMap(([end, nextEnd], gap) => {
    const [start, nextStart] = anchors[gap];
    const moved = previous.slice(start + 1, end);
    const targets = next.slice(nextStart + 1, nextEnd);
    if (targets.length === 0) return [];
    return moved.map((from, offset) => ({
      from,
      to: moved.length === targets.length ? targets[offset] : nearestTo(from, targets),
      index: start + 1 + offset
    }));
  });
}

// The other roads of the joints a road took along, and the lights and crossings on them. Joined roads stay joined.
export function followingEdits({key, before, feature}, context, freePoints = new Set()) {
  if (!before) return [];
  const roads = context.entriesOf(roadsFile);
  const nodes = context.entriesOf(nodesFile);
  const changes = new RoadChanges();
  const nodeEdits = [];
  for (const {from, to, index} of movedPoints(before, feature)) {
    if (freePoints.has(pointKey(from))) continue;
    const level = levelAt(before, index);
    const joint = jointAt(from, roads);
    const others = (joint?.members ?? []).filter(member => member.entry.key !== key && member.level === level);
    for (const {entry} of others) changes.change(entry, road => withPointMoved(road, from, to));
    const node = nodeEntryAt(nodes, from);
    if (node) nodeEdits.push({filename: nodesFile, key: node.key, after: {...node.feature, geometry: {...node.feature.geometry, coordinates: to}}});
  }
  return [...changes.edits(), ...nodeEdits];
}

// What a point put on other roads meets there: [{level, node}], a node only where one of them ends.
function metAt(coordinate, key, roads) {
  const others = entriesNear(coordinate, roads).filter(entry => entry.key !== key);
  const joint = jointAt(coordinate, others);
  if (joint) return joint.groups.map(({level, members}) => ({level, node: nodeOf(members)}));
  return others
    .filter(({feature}) => withJunctionAt(feature, coordinate, touchMetres) !== null)
    .map(({feature}) => ({level: levelAtPlace(feature, coordinate), node: null}));
}

function chosenMeeting(meetings, preferredLevel) {
  const levels = meetings.map(({level}) => level);
  const level = levels.includes(preferredLevel) ? preferredLevel : nearestToGround(levels);
  const node = meetings.find(meeting => meeting.level === level && meeting.node !== null)?.node ?? null;
  return {level, node};
}

// An end that was put on another level leaves its junction for the one that roads of that level share there.
function factsOnChosenLevel(end, feature, before, meetings) {
  const level = feature.properties[levelNameOf(end)] ?? 0;
  if (level === (before.properties[levelNameOf(end)] ?? 0)) return {};
  const node = meetings.find(meeting => meeting.level === level)?.node ?? newLocalId();
  return {[levelNameOf(end)]: level, [nodeNameOf(end)]: node};
}

// The junction and level of one end of a drawn or reshaped road, or nothing where they stay as they are.
function endFacts(end, {key, feature, before}, roads, {freePoints, preferredLevel}) {
  const index = end === 'start' ? 0 : -1;
  const coordinate = feature.geometry.coordinates.at(index);
  const previous = before?.geometry.coordinates.at(index);
  const meetings = metAt(coordinate, key, roads);
  if (previous && pointKey(previous) === pointKey(coordinate)) return factsOnChosenLevel(end, feature, before, meetings);
  if (meetings.length > 0) {
    const {level, node} = chosenMeeting(meetings, preferredLevel);
    return {[levelNameOf(end)]: level, [nodeNameOf(end)]: node ?? newLocalId()};
  }
  const level = feature.properties[levelNameOf(end)] ?? 0;
  // A junction that moves with its roads stays the same one.
  const isTakenAlong = previous && !freePoints.has(pointKey(previous)) && before.properties[nodeNameOf(end)] !== undefined;
  return isTakenAlong ? {[levelNameOf(end)]: level} : {[levelNameOf(end)]: level, [nodeNameOf(end)]: newLocalId()};
}

// A drawn or reshaped road with the junctions and levels of what its ends meet. A free point was disconnected, so its
// end leaves the junction; preferredLevel decides where roads of several levels share a point.
export function roadWithEnds(edit, roads, {freePoints = new Set(), preferredLevel = null} = {}) {
  const choices = {freePoints, preferredLevel};
  return withProperties(edit.feature, {
    ...endFacts('start', edit, roads, choices),
    ...endFacts('end', edit, roads, choices)
  });
}

// The other roads that get a point, because a drawn or reshaped road now touches them on its level there.
export function touchedRoadEdits({key, feature, before}, context) {
  const known = new Set((before?.geometry.coordinates ?? []).map(pointKey));
  const roads = context.entriesOf(roadsFile).filter(entry => entry.key !== key);
  const changes = new RoadChanges();
  feature.geometry.coordinates.forEach((point, index) => {
    if (known.has(pointKey(point))) return;
    const level = levelAt(feature, index);
    for (const entry of entriesNear(point, roads)) {
      const isTouched = withJunctionAt(entry.feature, point, touchMetres) !== null;
      if (!isTouched || levelAtPlace(entry.feature, point) !== level) continue;
      changes.change(entry, road => withJunctionAt(road, point, touchMetres) ?? road);
    }
  });
  return changes.edits();
}
