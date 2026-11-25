// Roads and paths: drawing that joins what it touches, reshaping that keeps the joins, splitting and joining, and who may
// use a road. The junctions themselves are edited in layer-junctions.js.
import {createElementWithText} from './dom.js';
import {valueLabel} from './field-catalog.js';
import {roundedCoordinate} from './geometry-editing.js';
import {formatLength, lineLengthMetres, nearestPointOnLine} from './geometry-measures.js';
import {junctionEntry, jointStatusText} from './layer-junctions.js';
import {disconnectedRoad, followingEdits, movedPoints, roadWithEnds, touchedRoadEdits} from './road-edits.js';
import {entriesWithin, jointAt, levelAt, levelAtPlace, nodeOf, pointKey, roadId} from './road-graph.js';
import {isOnWay, rulesAfterSplit} from './road-junctions.js';
import {endsOf, joinedRoad, splitProblem, splitRoad} from './road-shapes.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
const joinDistancePixels = 12;
const longestLinkMetres = 500;
const highestLevel = 5;

const kindGroups = [
  ['Streets', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']],
  ['Links (ramps)', ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link']],
  ['Walking and cycling', ['pedestrian', 'footway', 'path', 'track', 'cycleway', 'steps']]
];
const endLabels = {start: 'A', end: 'B'};

const roadName = ({properties}) => properties.name?.trim() || valueLabel('kind', properties.kind ?? 'road');

const viewBounds = bounds => [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];

// Where a point put at this place joins a road close to it on the screen, or null. ignoredKeys are the roads that move
// along. With one level shown, only its roads are joined.
function joiningPoint(coordinate, {map, entriesOf, shownLevel}, ignoredKeys = new Set()) {
  const point = map.project(coordinate);
  const roads = entriesWithin(entriesOf(roadsFile), viewBounds(map.getBounds())).filter(({key}) => !ignoredKeys.has(key));
  const level = shownLevel?.() ?? null;
  let nearest = null;
  for (const {feature} of roads) {
    const {coordinates} = feature.geometry;
    const candidate = nearestPointOnLine(coordinate, coordinates);
    if (level !== null && levelAtPlace(feature, candidate.coordinate) !== level) continue;
    if (!nearest || candidate.distanceMetres < nearest.distanceMetres) nearest = {...candidate, coordinates};
  }
  if (!nearest) return null;
  const isWithinReach = position => point.dist(map.project(position)) <= joinDistancePixels;
  // An existing point is joined rather than a new one beside it.
  const existingPoint = nearest.coordinates.find(isWithinReach);
  if (existingPoint) return existingPoint;
  return isWithinReach(nearest.coordinate) ? roundedCoordinate(nearest.coordinate) : null;
}

// Roads that share a point with this one move with it, so the point does not stick to where they were.
function joinedKeys(coordinate, entriesOf) {
  const joint = jointAt(coordinate, entriesOf(roadsFile));
  return (joint?.members ?? []).map(({entry}) => entry.key);
}

// A dragged point joins the road it is dragged onto.
function snappedWhileDragged(geometry, {key, feature, previousGeometry}, context) {
  const previous = previousGeometry.coordinates;
  if (previous.length !== geometry.coordinates.length) return geometry;
  const movedIndexes = geometry.coordinates.flatMap((point, index) =>
    pointKey(point) === pointKey(previous[index]) ? [] : [index]
  );
  if (movedIndexes.length !== 1) return geometry;
  const [index] = movedIndexes;
  const before = context.session.workingFeature(roadsFile, key) ?? feature;
  const origin = movedPoints(before, {...feature, geometry}).find(({to}) => pointKey(to) === pointKey(geometry.coordinates[index]));
  const ignored = new Set([key, ...(origin ? joinedKeys(origin.from, context.entriesOf) : [])]);
  const snapped = joiningPoint(geometry.coordinates[index], context, ignored);
  return snapped ? {...geometry, coordinates: geometry.coordinates.with(index, snapped)} : geometry;
}

// A select with its kinds in the groups people think in.
function kindControl(value) {
  const select = document.createElement('select');
  select.name = 'kind';
  const emptyOption = createElementWithText('option', 'Choose…');
  emptyOption.value = '';
  if (value === undefined) select.append(emptyOption);
  for (const [label, kinds] of kindGroups) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const kind of kinds) {
      const option = createElementWithText('option', valueLabel('kind', kind));
      option.value = kind;
      group.append(option);
    }
    select.append(group);
  }
  select.value = value ?? '';
  return select;
}

function roadSections({properties}, {context}) {
  const road = {title: 'Road', fields: ['name', 'name:en', 'kind', 'ref']};
  const access = {title: 'Who may use it', fields: ['motor_vehicle', 'foot', 'bicycle']};
  const driving = {title: 'Driving', fields: ['maxspeed', 'parking:both', 'parking:left', 'parking:right']};
  const more = {
    title: 'More',
    fields: ['surface', 'lit', 'smoothness', 'access', 'bridge', 'tunnel', 'layer', 'junction', 'pathClass', 'sac_scale'],
    isCollapsed: properties.bridge === undefined && properties.tunnel === undefined
  };
  if (context.isPhone()) return [{title: 'Road', fields: ['name', 'kind']}];
  return [road, access, {...driving, fields: ['oneway', ...driving.fields]}, more];
}

// The joint at one end of a road as it is drawn now, or null before it is drawn.
function jointOfEnd(end, {feature, key, context}) {
  const coordinate = endsOf(feature)[end === 'start' ? 0 : 1];
  const roads = context.entriesOf(roadsFile).filter(entry => entry.key !== key);
  return jointAt(coordinate, [...roads, {filename: roadsFile, key, feature}]);
}

function openJunction(edit, coordinate) {
  if (edit.hasUnappliedEdit()) edit.showProblem('Apply or Cancel this edit before you open a junction.');
  else edit.context.select(junctionEntry(coordinate));
}

function levelSelect(name, value, isDisabled) {
  const select = document.createElement('select');
  for (let level = highestLevel; level >= -highestLevel; level -= 1) {
    const option = createElementWithText('option', level === 0 ? '0 · on the ground' : String(level));
    option.value = String(level);
    select.append(option);
  }
  select.value = String(value);
  select.disabled = isDisabled;
  select.setAttribute('aria-label', name);
  return select;
}

// One end of the road: its letter on the map, what it joins, its level, and the way to its junction.
function endRow(end, edit) {
  const {feature, context} = edit;
  const {coordinates} = feature.geometry;
  const index = end === 'start' ? 0 : coordinates.length - 1;
  const row = document.createElement('div');
  row.className = 'end-row';
  const letter = createElementWithText('span', endLabels[end]);
  letter.className = 'end-letter';
  const joint = jointOfEnd(end, edit);
  const text = createElementWithText('span', jointStatusText(joint, edit.key));
  const level = levelSelect(`Level at ${endLabels[end]}`, levelAt(feature, index), context.isPhone());
  level.onchange = () => edit.setProperties({[`${end}Level`]: Number(level.value)});
  const open = createElementWithText('button', 'Junction');
  open.type = 'button';
  open.setAttribute('aria-label', `Open the junction at ${endLabels[end]}`);
  open.onclick = () => openJunction(edit, coordinates[index]);
  row.append(letter, text, level, open);
  return row;
}

// Both ends by the letters the map shows, so that nobody has to guess which end is meant.
function renderEnds(container, edit) {
  const isDrawn = edit.feature.geometry?.coordinates.length > 1;
  if (!isDrawn || edit.isNew) return;
  const heading = createElementWithText('h3', 'Ends');
  heading.className = 'section-title';
  container.append(heading, endRow('start', edit), endRow('end', edit));
}

const endMarks = feature => {
  if (!(feature.geometry?.coordinates.length > 1)) return [];
  const [start, end] = endsOf(feature);
  return [{coordinate: start, label: endLabels.start}, {coordinate: end, label: endLabels.end}];
};

// The points of a road that other roads share on the same level.
function joinedPoints({key, feature}, context) {
  const roads = context.entriesOf(roadsFile).filter(entry => entry.key !== key);
  return feature.geometry.coordinates.filter((coordinate, index) => {
    const joint = jointAt(coordinate, roads);
    const level = levelAt(feature, index);
    return joint?.members.some(member => member.level === level) ?? false;
  });
}

const freePointsOf = extras => new Set(extras?.freePoints ?? []);

// Takes the picked point out of its joint, so that it moves alone from then on.
function disconnectTool(feature, handle, edit) {
  const coordinate = handle && feature.geometry.coordinates[handle.vertexIndex];
  const isJoined = coordinate && joinedPoints(edit, edit.context).some(point => pointKey(point) === pointKey(coordinate));
  return {
    id: 'vertex-disconnect',
    label: 'Disconnect',
    isDisabled: !isJoined,
    run: () => {
      const disconnected = disconnectedRoad(feature, handle.vertexIndex);
      if (!disconnected) return edit.showProblem('This road is too short to be pulled back.');
      const freePoints = [...(edit.extras.freePoints ?? []), pointKey(coordinate)];
      edit.setExtras({freePoints});
      return edit.setFeature(disconnected);
    }
  };
}

// At the desk a road can be split at its picked point. Both halves are one step and meet at one junction.
function splitTool(feature, handle, edit) {
  return {
    id: 'vertex-split',
    label: 'Split here',
    isDisabled: !handle || Boolean(splitProblem(feature, handle.vertexIndex)),
    run: () => {
      const {context, key} = edit;
      const secondKey = `local:${crypto.randomUUID()}`;
      const {edits, problem} = rulesAfterSplit(context.entriesOf(restrictionsFile), {key, feature}, secondKey);
      if (problem) return edit.showProblem(problem);
      const coordinate = feature.geometry.coordinates[handle.vertexIndex];
      const level = levelAt(feature, handle.vertexIndex);
      const joint = jointAt(coordinate, context.entriesOf(roadsFile).filter(entry => entry.key !== key));
      const others = joint?.members.filter(member => member.level === level) ?? [];
      const junction = {level, node: nodeOf(others) ?? `local:${crypto.randomUUID()}`};
      const [first, second] = splitRoad(feature, handle.vertexIndex, context.rules.layers[roadsFile].properties, junction);
      edit.setFeature(first);
      return edit.applyWith([{filename: roadsFile, key: secondKey, after: second}, ...edits]);
    }
  };
}

// Turn rules of either road that a join would break: the other road's way is gone, and so is the junction between them.
function hasRulesLostByJoin({key, feature}, otherEntry, context) {
  const restrictions = context.entriesOf(restrictionsFile);
  const other = otherEntry.feature;
  const otherWay = roadId(otherEntry);
  const way = roadId({key, feature});
  const [, end] = endsOf(feature);
  const isJoinedAtEnd = endsOf(other).some(point => pointKey(point) === pointKey(end));
  const joinedNode = isJoinedAtEnd ? feature.properties.endNode : feature.properties.startNode;
  return restrictions.some(restriction => {
    const isAtJoin = isOnWay(restriction, way) && restriction.feature.properties.viaNodes?.includes(joinedNode);
    return isOnWay(restriction, otherWay) || isAtJoin;
  });
}

async function joinWithPicked(edit) {
  const {context, key} = edit;
  const other = await context.pick(roadsFile, 'Pick the road that continues this one');
  if (!other || other.key === key || !edit.isOpen()) return;
  const feature = edit.typedFeature();
  const joined = joinedRoad(feature, other.feature);
  if (!joined) {
    edit.showProblem('These roads do not meet end to end.');
    return;
  }
  if (hasRulesLostByJoin({key, feature}, other, context)) {
    edit.showProblem('These roads have turn rules that a join would lose. Remove them first.');
    return;
  }
  edit.setFeature(joined);
  edit.applyWith([{filename: roadsFile, key: other.key, after: null}]);
}

function lengthFacts({geometry}, before) {
  if (!geometry) return [];
  const length = lineLengthMetres(geometry.coordinates);
  const facts = [`Length ${formatLength(length)}`];
  if (length > longestLinkMetres && !before) facts.push('Long for one road link: split it at about 200–500 m.');
  return facts;
}

// Turn rules of a deleted road would name a road that is gone.
function roadDeletion(entry, context) {
  const way = roadId(entry);
  const restrictions = context.entriesOf(restrictionsFile).filter(restriction => isOnWay(restriction, way));
  return {
    message: restrictions.length > 0 ? `${restrictions.length} turn rules go with it.` : '',
    edits: restrictions.map(({filename, key}) => ({filename, key, after: null}))
  };
}

function roadVertexTools(feature, handle, edit) {
  if (edit.isNew) return [];
  const disconnect = disconnectTool(feature, handle, edit);
  return edit.context.isPhone() ? [disconnect] : [disconnect, splitTool(feature, handle, edit)];
}

// Rules from before roads had junctions of the editor cannot say where an end is.
const canNameJunctions = ({rules}) => rules.layers[roadsFile].properties.startNode?.type === 'identifier';

function preparedRoad(feature, context, {key, extras}) {
  if (!canNameJunctions(context) || !feature.geometry) return feature;
  const before = context.session.workingFeature(roadsFile, key);
  const choices = {freePoints: freePointsOf(extras), preferredLevel: context.shownLevel?.() ?? null};
  return roadWithEnds({key, feature, before}, context.entriesOf(roadsFile), choices);
}

// Roads joined to a moved point go with it, and roads that a new point touches get one there.
function roadCompanions(edit, context) {
  const following = followingEdits(edit, context, freePointsOf(edit.extras));
  const followingKeys = new Set(following.map(({key}) => key));
  const touched = touchedRoadEdits(edit, context).filter(({key}) => !followingKeys.has(key));
  return [...touched, ...following];
}

export const roadBehaviors = {
  [roadsFile]: {
    kind: ({properties}) => `Road · ${valueLabel('kind', properties.kind ?? 'new')}`,
    title: roadName,
    sections: roadSections,
    controls: () => ({kind: kindControl}),
    tools: (_feature, edit) => (edit.isNew ? [] : [{label: 'Join roads', isDesktopOnly: true, run: () => joinWithPicked(edit)}]),
    vertexTools: roadVertexTools,
    snappedPoint: ({lngLat}, context) => joiningPoint(lngLat.toArray(), context),
    limitedGeometry: snappedWhileDragged,
    measures: lengthFacts,
    renderExtras: renderEnds,
    marks: endMarks,
    joinedPoints,
    prepared: preparedRoad,
    companionEdits: roadCompanions,
    deletion: roadDeletion
  },
  [nodesFile]: {
    sections: () => [{title: 'Junction', fields: ['kind', 'crossing', 'traffic_signals']}]
  }
};
