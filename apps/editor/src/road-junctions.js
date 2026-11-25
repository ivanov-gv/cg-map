// What may be driven at a joint: the ways out of it, the turns between them, and what the recorded rules say.
import {metricOffset} from './geometry-measures.js';
import {isSamePoint} from './road-shapes.js';
import {nodeOf, roadId} from './road-graph.js';

const straightAheadDegrees = 30;
const uTurnDegrees = 160;
const fullTurnDegrees = 360;
const walkingKinds = new Set(['pedestrian', 'footway', 'path', 'cycleway', 'steps']);
const compassNames = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

const directionDegrees = (from, to) => {
  const [east, north] = metricOffset(to, from);
  return (Math.atan2(east, north) * 180) / Math.PI;
};

const restrictionNames = {left: 'no_left_turn', right: 'no_right_turn', straight: 'no_straight_on', uTurn: 'no_u_turn'};

export function turnKind(degrees) {
  if (Math.abs(degrees) >= uTurnDegrees) return 'uTurn';
  if (Math.abs(degrees) <= straightAheadDegrees) return 'straight';
  return degrees > 0 ? 'right' : 'left';
}

export const restrictionFor = kind => restrictionNames[kind];

export const isDrivable = ({properties}) =>
  !walkingKinds.has(properties.kind) && properties.motor_vehicle !== 'no';

// Which way traffic may follow the line of a road. A roundabout or motorway goes one way unless it says otherwise.
function drivingDirections({oneway, junction, kind}) {
  const isAgainst = oneway === '-1';
  const isOneWayKind = junction === 'roundabout' || kind === 'motorway' || kind === 'motorway_link';
  const isAlong = ['yes', 'true', '1'].includes(oneway) || (oneway === undefined && isOneWayKind);
  return {along: !isAgainst, against: !isAlong};
}

// One way in and out of a joint: a road that ends there has one, a road that passes has two.
function armsOfMember(member) {
  const {feature} = member.entry;
  const {coordinates} = feature.geometry;
  const {along, against} = drivingDirections(feature.properties);
  const arms = [];
  if (member.index > 0) {
    arms.push({member, next: coordinates[member.index - 1], canArrive: along, canLeave: against});
  }
  if (member.index < coordinates.length - 1) {
    arms.push({member, next: coordinates[member.index + 1], canArrive: against, canLeave: along});
  }
  return arms;
}

// The compass direction in which an arm leaves the joint, to tell two parts of one street apart.
export function compassOf(coordinate, next) {
  const degrees = (directionDegrees(coordinate, next) + fullTurnDegrees) % fullTurnDegrees;
  const step = fullTurnDegrees / compassNames.length;
  return compassNames[Math.round(degrees / step) % compassNames.length];
}

// How far someone turns from one arm onto another: positive to the right, in degrees.
function turnDegrees(coordinate, from, to) {
  const turn = directionDegrees(coordinate, to.next) - directionDegrees(from.next, coordinate);
  return ((turn + fullTurnDegrees * 1.5) % fullTurnDegrees) - fullTurnDegrees / 2;
}

// The turns at a joint by the arm they come from, [{from, turns: [{to, kind, canRecord}]}], for the roads of each level.
// A rule names whole roads, so a turn can be recorded only between roads that end here.
export function turnsAt({coordinate, groups}) {
  return groups.flatMap(({members}) => {
    const arms = members.filter(({entry}) => isDrivable(entry.feature)).flatMap(armsOfMember);
    if (arms.length < 2) return [];
    return arms
      .filter(({canArrive}) => canArrive)
      .map(from => {
        const turns = arms
          .filter(to => to.canLeave && (to === from || to.member !== from.member))
          .map(to => ({
            to,
            kind: to === from ? 'uTurn' : turnKind(turnDegrees(coordinate, from, to)),
            canRecord: from.member.end !== null && to.member.end !== null
          }));
        return {from, members, turns};
      });
  });
}

export const turnKey = (from, to) => `turn:${armKey(from)}>${armKey(to)}`;
const armKey = ({member}) => `${member.entry.key}/${member.index}`;

const isAtJunction = ({feature}, fromId, node) =>
  feature.properties.from === fromId && Boolean(feature.properties.viaNodes?.includes(node));

// What the recorded rules say about one turn: {isForbidden, recorded, onlyRule}. A "no" rule forbids its own turn and can
// be edited as that turn. An "only" rule forbids every other turn of the road at once.
export function turnRule(restrictions, fromId, toId, node) {
  const rules = restrictions.filter(restriction => isAtJunction(restriction, fromId, node));
  const recorded = rules.find(
    ({feature}) => feature.properties.to === toId && feature.properties.restriction.startsWith('no_')
  );
  const onlyRule = rules.find(({feature}) => feature.properties.restriction.startsWith('only_'));
  const isForbiddenByOnly = onlyRule !== undefined && onlyRule.feature.properties.to !== toId;
  return {isForbidden: recorded !== undefined || isForbiddenByOnly, recorded, onlyRule};
}

// The rule of one turn at a joint.
export function ruleOfTurn(restrictions, from, to, members) {
  return turnRule(restrictions, roadId(from.member.entry), roadId(to.member.entry), nodeOf(members));
}

export const isOnWay = ({feature}, way) => {
  const {from, to, viaWays = []} = feature.properties;
  return from === way || to === way || viaWays.includes(way);
};

// Turn rules of a road that is split: those at the end of its second half name that half from then on, those through it
// would be lost. Returns {edits, problem}.
export function rulesAfterSplit(restrictions, entry, secondKey) {
  const way = roadId(entry);
  const {startNode, endNode} = entry.feature.properties;
  const own = restrictions.filter(restriction => isOnWay(restriction, way));
  const edits = [];
  for (const {filename, key, feature} of own) {
    const {from, to, viaNodes = [], viaWays = []} = feature.properties;
    const isThrough = viaWays.includes(way) || viaNodes.length === 0;
    const isAtBothEnds = startNode !== undefined && startNode === endNode;
    if (isThrough || isAtBothEnds) return {edits: [], problem: 'This road has turn rules that a split would lose. Remove them first.'};
    if (!viaNodes.includes(endNode)) continue;
    const renamed = value => (value === way ? secondKey : value);
    const properties = {...feature.properties, from: renamed(from), to: renamed(to)};
    edits.push({filename, key, after: {...feature, properties}});
  }
  return {edits, problem: null};
}

export const nodeEntryAt = (nodes, coordinate) =>
  nodes.find(({feature}) => isSamePoint(feature.geometry.coordinates, coordinate)) ?? null;
