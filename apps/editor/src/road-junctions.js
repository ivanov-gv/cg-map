// What may be driven at the end of a road: which roads meet there, which turns are forbidden, whether there is a light.
import {metricOffset} from './geometry-measures.js';
import {endsOf, isSamePoint} from './road-shapes.js';

const straightAheadDegrees = 30;
const uTurnDegrees = 160;
const fullTurnDegrees = 360;

export const wayNumber = entityId => {
  const match = /^way\/(\d+)$/.exec(entityId ?? '');
  return match ? Number(match[1]) : null;
};

const directionDegrees = (from, to) => {
  const [east, north] = metricOffset(to, from);
  return (Math.atan2(east, north) * 180) / Math.PI;
};

// How far someone turns from a road onto another at their shared point: positive to the right, in degrees.
function turnDegrees(road, other, junction) {
  const before = road.geometry.coordinates.at(-2);
  const otherCoordinates = other.geometry.coordinates;
  const startsHere = isSamePoint(otherCoordinates[0], junction);
  const after = startsHere ? otherCoordinates[1] : otherCoordinates.at(-2);
  const turn = directionDegrees(junction, after) - directionDegrees(before, junction);
  return ((turn + fullTurnDegrees * 1.5) % fullTurnDegrees) - fullTurnDegrees / 2;
}

const restrictionNames = {left: 'no_left_turn', right: 'no_right_turn', straight: 'no_straight_on', uTurn: 'no_u_turn'};

export function turnKind(degrees) {
  if (Math.abs(degrees) >= uTurnDegrees) return 'uTurn';
  if (Math.abs(degrees) <= straightAheadDegrees) return 'straight';
  return degrees > 0 ? 'right' : 'left';
}

export const restrictionFor = kind => restrictionNames[kind];

// The turns from the end of a road: onto every road that meets it there on the same level, and back onto itself.
// [{road: entry, kind}]. A road without a level is on the ground.
export function turnsAtEnd(road, roads) {
  const [, junction] = endsOf(road.feature);
  const level = road.feature.properties.endLevel ?? 0;
  const turns = [];
  for (const other of roads) {
    if (other.key === road.key) continue;
    const [start, end] = endsOf(other.feature);
    const isMeetingStart = isSamePoint(start, junction) && (other.feature.properties.startLevel ?? 0) === level;
    const isMeetingEnd = isSamePoint(end, junction) && (other.feature.properties.endLevel ?? 0) === level;
    if (!isMeetingStart && !isMeetingEnd) continue;
    turns.push({road: other, kind: turnKind(turnDegrees(road.feature, other.feature, junction))});
  }
  return [...turns, {road, kind: 'uTurn'}];
}

// The restriction of one turn among the recorded ones, or undefined.
export function recordedRestriction(restrictions, fromWay, toWay, junctionNode) {
  return restrictions.find(({feature}) => {
    const {from, to, viaNodes} = feature.properties;
    return from === fromWay && to === toWay && (!viaNodes || viaNodes.includes(junctionNode));
  });
}

export const isOnWay = ({feature}, way) => {
  const {from, to, viaWays = []} = feature.properties;
  return from === way || to === way || viaWays.includes(way);
};

export const trafficLightAt = (nodes, coordinate) =>
  nodes.find(
    ({feature}) =>
      feature.properties.kind === 'traffic_signals' && isSamePoint(feature.geometry.coordinates, coordinate)
  );
