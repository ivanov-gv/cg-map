// The road graph, read from the roads themselves: two roads join where they share a point on the same level. Everything
// here is pure; what changes a junction is in road-edits.js.
import {distanceMetres, metricOffset, nearestPointOnLine} from '../../geometry/geometry-measures.js';

const keyDecimals = 6;
// An end this close to another road was probably meant to join it.
const nearMissMetres = 1;
// Lines that share a point touch there up to rounding, which is no crossing.
const touchMetres = 0.3;
const bridgeLevel = 1;
const tunnelLevel = -1;

// Roads that share a point have it digit for digit, up to the rounding of the sources.
export const pointKey = ([longitude, latitude]) => `${longitude.toFixed(keyDecimals)} ${latitude.toFixed(keyDecimals)}`;

const isSet = value => value !== undefined && value !== '' && value !== 'no';

// The level of a road along its length, as the data pipeline reads it. 0 is the ground.
export function roadLevel({layer, bridge, tunnel}) {
  const stated = Number.parseInt(layer ?? '', 10);
  if (Number.isInteger(stated)) return stated;
  if (isSet(bridge)) return bridgeLevel;
  return isSet(tunnel) ? tunnelLevel : 0;
}

const endNames = {
  start: {node: 'startNode', level: 'startLevel'},
  end: {node: 'endNode', level: 'endLevel'}
};
export const nodeNameOf = end => endNames[end].node;
export const levelNameOf = end => endNames[end].level;

function endAt(index, pointCount) {
  if (index === 0) return 'start';
  return index === pointCount - 1 ? 'end' : null;
}

// The level of a road at one of its points. An end without a level is on the ground.
export function levelAt({geometry, properties}, index) {
  const end = endAt(index, geometry.coordinates.length);
  return end ? (properties[levelNameOf(end)] ?? 0) : roadLevel(properties);
}

// Every level a road is on, for showing one level at a time: a stairway is on those of both its ends.
export function levelsOf({geometry, properties}) {
  const ends = [levelAt({geometry, properties}, 0), levelAt({geometry, properties}, geometry.coordinates.length - 1)];
  return [...new Set([roadLevel(properties), ...ends])];
}

// The level nearest to the ground, the upper one of two as near, as the data pipeline decides between ends.
export const nearestToGround = levels =>
  levels.reduce((nearest, level) => {
    const isNearer = Math.abs(level) < Math.abs(nearest) || (Math.abs(level) === Math.abs(nearest) && level > nearest);
    return isNearer ? level : nearest;
  });

const boundsByFeature = new WeakMap();

// Every point of a line or of the outlines of an area.
const nestedPointLevels = {Polygon: 1, MultiPolygon: 2};
const pointsOf = ({type, coordinates}) => coordinates.flat(nestedPointLevels[type] ?? 0);

// The box around a line or an area.
export function boundsOf(feature) {
  if (!boundsByFeature.has(feature)) {
    const points = pointsOf(feature.geometry);
    const longitudes = points.map(([longitude]) => longitude);
    const latitudes = points.map(([, latitude]) => latitude);
    const bounds = [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
    boundsByFeature.set(feature, bounds);
  }
  return boundsByFeature.get(feature);
}

// The entries whose box reaches into [west, south, east, north]. Boxes are kept, so this stays quick on every move.
export function entriesWithin(entries, [west, south, east, north]) {
  return entries.filter(({feature}) => {
    const {geometry} = feature;
    const isUnfinishedLine = geometry?.type === 'LineString' && geometry.coordinates.length < 2;
    if (!geometry || isUnfinishedLine) return false;
    const [left, bottom, right, top] = boundsOf(feature);
    return left <= east && right >= west && bottom <= north && top >= south;
  });
}

// The box on the map that a finger covers around a place.
export function boundsAround(coordinate, map, pixels = 16) {
  const {x, y} = map.project(coordinate);
  const corners = [map.unproject([x - pixels, y - pixels]), map.unproject([x + pixels, y + pixels])];
  const longitudes = corners.map(({lng}) => lng);
  const latitudes = corners.map(({lat}) => lat);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

// Rules from before roads had junctions of the editor cannot say where an end is.
export const canNameJunctions = rules =>
  rules.layers['roads.geojson']?.properties.startNode?.type === 'identifier' && Boolean(rules.layers['road-nodes.geojson']);

const metresPerDegree = 111200;

// The box that reaches this far from a place on every side.
export function boundsAroundMetres([longitude, latitude], metres) {
  const north = metres / metresPerDegree;
  const east = north / Math.cos((latitude * Math.PI) / 180);
  return [longitude - east, latitude - north, longitude + east, latitude + north];
}

export const boxAround = ([longitude, latitude], degrees = 0.00005) => [
  longitude - degrees,
  latitude - degrees,
  longitude + degrees,
  latitude + degrees
];

export const entriesNear = (coordinate, entries) => entriesWithin(entries, boxAround(coordinate));

// A road that comes back to where it starts has no ends.
export const isRing = ({geometry: {coordinates}}) =>
  coordinates.length > 3 && pointKey(coordinates[0]) === pointKey(coordinates.at(-1));

// One road at one point: {entry, index, end, isRing, level}. end is 'start', 'end' or null where the road passes. A ring
// is there once, at the point where its line begins.
function membersOf(entry) {
  const {coordinates} = entry.feature.geometry;
  const isClosed = isRing(entry.feature);
  const points = isClosed ? coordinates.slice(0, -1) : coordinates;
  return points.map((coordinate, index) => {
    const end = endAt(index, coordinates.length);
    return {entry, index, end, isRing: isClosed && end !== null, level: levelAt(entry.feature, index)};
  });
}

const coordinateOf = ({entry, index}) => entry.feature.geometry.coordinates[index];

function membersByPoint(entries) {
  const members = new Map();
  for (const member of entries.flatMap(membersOf)) {
    const key = pointKey(coordinateOf(member));
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(member);
  }
  return members;
}

// Around what is asked for, so that the next questions of a drag find it ready. The session replaces a file's entries
// as a whole, so the array's identity says when an answer must be found again. Each caller keeps its own answer: a road
// member map and a list of reshapable areas are not interchangeable for the same file.
const keptMarginDegrees = 0.002;

const contains = (outer, inner) =>
  outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

// Makes a private cache. The scope distinguishes different questions of one kind, such as two editing rules.
export function createKeptBox() {
  const keptByEntries = new WeakMap();
  return (entries, bounds, findWithin, scope = null) => {
    let byScope = keptByEntries.get(entries);
    if (!byScope) {
      byScope = new Map();
      keptByEntries.set(entries, byScope);
    }
    const kept = byScope.get(scope);
    if (kept && contains(kept.bounds, bounds)) return kept.value;
    const [west, south, east, north] = bounds;
    const wideBounds = [
      west - keptMarginDegrees,
      south - keptMarginDegrees,
      east + keptMarginDegrees,
      north + keptMarginDegrees
    ];
    const value = findWithin(wideBounds);
    byScope.set(scope, {bounds: wideBounds, value});
    return value;
  };
}

const keptMembersWithin = createKeptBox();

// The members of every point within bounds, from one wide read of the file.
function membersWithin(entries, bounds) {
  return keptMembersWithin(entries, bounds, wideBounds => membersByPoint(entriesWithin(entries, wideBounds)));
}

// The roads of a point by level, as [{level, members}], the ground first.
function levelGroups(members) {
  const groups = Map.groupBy(members, ({level}) => level);
  return [...groups]
    .map(([level, groupMembers]) => ({level, members: groupMembers}))
    .sort((first, second) => Math.abs(first.level) - Math.abs(second.level) || second.level - first.level);
}

// An extracted road cut by the edge of the detailed map ends there without a junction.
const isCutOff = ({entry, end}) => {
  const {properties} = entry.feature;
  return end !== null && /^way\//.test(properties.entityId ?? '') && properties[nodeNameOf(end)] === undefined;
};

function statusOf(members, groups) {
  if (groups.length > 1) return 'apart';
  if (members.length > 1 || members[0].isRing) return 'joined';
  return isCutOff(members[0]) ? 'cutOff' : 'deadEnd';
}

// A joint of these members, or null without any.
export function jointFrom(members) {
  if (members.length === 0) return null;
  const groups = levelGroups(members);
  return {coordinate: coordinateOf(members[0]), members, groups, status: statusOf(members, groups)};
}

// The members of a point, except those of some roads.
export function membersAt(coordinate, entries, exceptKeys = new Set()) {
  const members = membersWithin(entries, boxAround(coordinate)).get(pointKey(coordinate)) ?? [];
  return members.filter(({entry}) => !exceptKeys.has(entry.key));
}

// The joint at a point, or null where no road has one.
export const jointAt = (coordinate, entries, exceptKeys) => jointFrom(membersAt(coordinate, entries, exceptKeys));

// The joint at a point of a road as it is being edited.
export function jointWith({key, feature}, index, entries) {
  const own = membersOf({filename: 'roads.geojson', key, feature}).filter(member => member.index === index);
  return jointFrom([...own, ...membersAt(feature.geometry.coordinates[index], entries, new Set([key]))]);
}

// The points of a road that other roads share on the same level.
export function sharedPointsOf({key, feature}, entries) {
  const members = membersWithin(entries, boundsOf(feature));
  return feature.geometry.coordinates.filter((coordinate, index) => {
    const others = members.get(pointKey(coordinate)) ?? [];
    return others.some(other => other.entry.key !== key && other.level === levelAt(feature, index));
  });
}

// The road that an end should probably join: one that passes close by on the same level without sharing the point.
export function missedRoad({entry, index, level}, entries) {
  const coordinate = entry.feature.geometry.coordinates[index];
  const candidates = entriesWithin(entries, boxAround(coordinate)).filter(({key}) => key !== entry.key);
  for (const other of candidates) {
    const nearest = nearestPointOnLine(coordinate, other.feature.geometry.coordinates);
    if (nearest.distanceMetres > nearMissMetres) continue;
    const otherLevel = levelAtPlace(other.feature, nearest.coordinate);
    if (otherLevel === level) return {entry: other, ...nearest, level: otherLevel};
  }
  return null;
}

// The level of a road where another one comes close: that of its end when it comes close to that.
export function levelAtPlace(feature, coordinate) {
  const {coordinates} = feature.geometry;
  if (distanceMetres(coordinate, coordinates[0]) < nearMissMetres) return levelAt(feature, 0);
  if (distanceMetres(coordinate, coordinates.at(-1)) < nearMissMetres) return levelAt(feature, coordinates.length - 1);
  return roadLevel(feature.properties);
}

// Where two segments cross between their ends, or null.
function crossingOf(start, end, otherStart, otherEnd) {
  const side = metricOffset(end, start);
  const otherSide = metricOffset(otherEnd, otherStart);
  const between = metricOffset(otherStart, start);
  const divisor = side[0] * otherSide[1] - side[1] * otherSide[0];
  if (divisor === 0) return null;
  const along = (between[0] * otherSide[1] - between[1] * otherSide[0]) / divisor;
  const otherAlong = (between[0] * side[1] - between[1] * side[0]) / divisor;
  const isInner = (fraction, [east, north]) => {
    const length = Math.hypot(east, north);
    return fraction * length > touchMetres && (1 - fraction) * length > touchMetres;
  };
  const isCrossing = isInner(along, side) && isInner(otherAlong, otherSide);
  return isCrossing ? [start[0] + along * (end[0] - start[0]), start[1] + along * (end[1] - start[1])] : null;
}

const mayOverlap = (first, second) =>
  first[0] <= second[2] && first[2] >= second[0] && first[1] <= second[3] && first[3] >= second[1];

const segmentBounds = (start, end) => [
  Math.min(start[0], end[0]),
  Math.min(start[1], end[1]),
  Math.max(start[0], end[0]),
  Math.max(start[1], end[1])
];

function crossingsOfRoads(first, second) {
  const crossings = [];
  const firstPoints = first.feature.geometry.coordinates;
  const secondPoints = second.feature.geometry.coordinates;
  for (let index = 1; index < firstPoints.length; index += 1) {
    const bounds = segmentBounds(firstPoints[index - 1], firstPoints[index]);
    if (!mayOverlap(bounds, boundsOf(second.feature))) continue;
    for (let otherIndex = 1; otherIndex < secondPoints.length; otherIndex += 1) {
      const otherBounds = segmentBounds(secondPoints[otherIndex - 1], secondPoints[otherIndex]);
      if (!mayOverlap(bounds, otherBounds)) continue;
      const coordinate = crossingOf(firstPoints[index - 1], firstPoints[index], secondPoints[otherIndex - 1], secondPoints[otherIndex]);
      if (coordinate) crossings.push({coordinate, segmentIndex: index - 1, otherSegmentIndex: otherIndex - 1});
    }
  }
  return crossings;
}

// Places where two roads of one level cross without sharing a point: {coordinate, status: 'crossing', roads}.
export function unjoinedCrossings(entries) {
  const crossings = [];
  // From west to east, so each road meets only those that begin before it ends.
  const ordered = entries.toSorted((first, second) => boundsOf(first.feature)[0] - boundsOf(second.feature)[0]);
  ordered.forEach((road, index) => {
    const bounds = boundsOf(road.feature);
    const level = roadLevel(road.feature.properties);
    for (let next = index + 1; next < ordered.length && boundsOf(ordered[next].feature)[0] <= bounds[2]; next += 1) {
      const other = ordered[next];
      if (!mayOverlap(bounds, boundsOf(other.feature)) || roadLevel(other.feature.properties) !== level) continue;
      for (const {coordinate, ...segments} of crossingsOfRoads(road, other)) {
        crossings.push({coordinate, status: 'crossing', roads: [road, other], segments, level});
      }
    }
  });
  return crossings;
}

export const isWithin = ([longitude, latitude], [west, south, east, north]) =>
  longitude >= west && longitude <= east && latitude >= south && latitude <= north;

// Every joint in a view: where roads join or end, and where they touch or cross without joining.
export function jointsIn(bounds, allEntries) {
  const entries = entriesWithin(allEntries, bounds);
  const joints = [];
  for (const members of membersByPoint(entries).values()) {
    const [first] = members;
    const isNoJoint = members.length === 1 && (first.end === null || first.isRing);
    if (isNoJoint || !isWithin(coordinateOf(first), bounds)) continue;
    const joint = jointFrom(members);
    const missed = joint.status === 'deadEnd' ? missedRoad(first, entries) : null;
    joints.push(missed ? {...joint, status: 'near', missed} : joint);
  }
  return [...joints, ...unjoinedCrossings(entries).filter(({coordinate}) => isWithin(coordinate, bounds))];
}

// The joint someone picked, as it stands now. A crossing is no joint yet, so it is found again by its place.
export function jointNear(coordinate, entries) {
  const joint = jointAt(coordinate, entries);
  if (joint) {
    const missed = joint.status === 'deadEnd' ? missedRoad(joint.members[0], entries) : null;
    return missed ? {...joint, status: 'near', missed} : joint;
  }
  const crossings = unjoinedCrossings(entriesWithin(entries, boxAround(coordinate)));
  return crossings.find(crossing => pointKey(crossing.coordinate) === pointKey(coordinate)) ?? null;
}

export const nodeOfMember = ({entry, end}) => (end ? entry.feature.properties[nodeNameOf(end)] : undefined);

// The junction ID the roads of one level share at a point. An OSM number stands before one from the editor.
export function nodeOf(members) {
  const nodes = members.map(nodeOfMember).filter(node => node !== undefined);
  return nodes.find(Number.isInteger) ?? nodes[0] ?? null;
}

// How turn rules name a road: an OSM way by its number, one added in the editor by its local ID.
export function roadId({key, feature}) {
  const match = /^way\/(\d+)$/.exec(feature.properties.entityId ?? '');
  return match ? Number(match[1]) : (feature.properties.entityId ?? key);
}
