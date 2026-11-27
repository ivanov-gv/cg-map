// Roads and paths: drawing that joins what it touches, reshaping that keeps the joins, splitting and joining, and who may
// use a road. The junctions themselves are edited in layer-junctions.js.
import {createElementWithText} from '../../shared/dom.js';
import {valueLabel} from '../../inspector/field-catalog.js';
import {formatLength, lineLengthMetres} from '../../geometry/geometry-measures.js';
import {joinableRoads, junctionEntry, jointStatusText, levelOptions} from './layer-junctions.js';
import {joiningPoint, withPoint} from '../../geometry/line-joining.js';
import {companionsOfRoad, disconnectedRoad, disconnectProblem, roadWithEnds} from './road-edits.js';
import {canNameJunctions, isRing, jointWith, levelAt, membersAt, nodeOf, pointKey, roadId, sharedPointsOf} from './road-graph.js';
import {isOnWay, rulesAfterSplit} from './road-junctions.js';
import {endsOf, joinedRoad, splitProblem, splitRoad} from './road-shapes.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
const longestLinkMetres = 500;

const kindGroups = [
  ['Streets', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']],
  ['Links (ramps)', ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link']],
  ['Walking and cycling', ['pedestrian', 'footway', 'path', 'track', 'cycleway', 'steps']]
];
const endLabels = {start: 'A', end: 'B'};

const roadName = ({properties}) => properties.name?.trim() || valueLabel('kind', properties.kind ?? 'road');

const joinedRoadPoint = (coordinate, context, ignoredKeys) =>
  joiningPoint(coordinate, joinableRoads(coordinate, context, ignoredKeys), context);

// Where the dragged point was when the edit was opened, or null when it was added since.
function originOfPoint(index, {key, feature, origins}, context) {
  const before = context.session.workingFeature(roadsFile, key) ?? feature;
  const origin = origins ? origins[index] : index;
  return Number.isInteger(origin) ? before.geometry.coordinates[origin] : null;
}

// Both points of a ring where it begins are one.
function keptClosed(geometry, index, previousGeometry) {
  const last = geometry.coordinates.length - 1;
  const isWhereItBegins = index === 0 || index === last;
  if (!isWhereItBegins || !isRing({geometry: previousGeometry})) return geometry;
  return withPoint(withPoint(geometry, 0, geometry.coordinates[index]), last, geometry.coordinates[index]);
}

// A dragged point joins the road it is dragged onto. What is joined to it already moves along, so it does not stick to
// where that was.
function snappedWhileDragged(geometry, change, context) {
  const index = change.draggedIndex;
  if (index === null) return geometry;
  const origin = originOfPoint(index, change, context);
  const along = origin ? membersAt(origin, context.entriesOf(roadsFile)).map(({entry}) => entry.key) : [];
  const joined = joinedRoadPoint(geometry.coordinates[index], context, new Set([change.key, ...along]));
  const dragged = joined ? withPoint(geometry, index, joined) : geometry;
  return keptClosed(dragged, index, change.previousGeometry);
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

function openJunction(edit, coordinate) {
  if (edit.hasUnappliedEdit()) edit.showProblem('Apply or Cancel this edit before you open a junction.');
  else edit.context.select(junctionEntry(coordinate));
}

function levelSelect(name, value, isDisabled) {
  const select = document.createElement('select');
  select.append(...levelOptions());
  select.value = String(value);
  select.disabled = isDisabled;
  select.setAttribute('aria-label', name);
  return select;
}

const openedEndKey = (end, {key, feature, context}) => {
  const opened = context.session.workingFeature(roadsFile, key) ?? feature;
  return pointKey(opened.geometry.coordinates.at(end === 'start' ? 0 : -1));
};

// An end on another level than it was opened on leaves what it was joined to, also when it is dragged in the same edit.
// These points are kept apart from a Disconnect: taking a level back must not undo it.
export function freePointsWithLevel(end, level, edit) {
  const key = openedEndKey(end, edit);
  const others = (edit.extras.freePoints ?? []).filter(point => point !== key);
  const opened = edit.context.session.workingFeature(roadsFile, edit.key) ?? edit.feature;
  const openedLevel = levelAt(opened, end === 'start' ? 0 : opened.geometry.coordinates.length - 1);
  return level === openedLevel ? others : [...others, key];
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
  const joint = jointWith(edit, isRing(feature) ? 0 : index, context.entriesOf(roadsFile));
  const text = createElementWithText('span', jointStatusText(joint, edit.key));
  const level = levelSelect(`Level at ${endLabels[end]}`, levelAt(feature, index), context.isPhone() || isRing(feature));
  level.onchange = () => {
    edit.setExtras({freePoints: freePointsWithLevel(end, Number(level.value), edit)});
    edit.setProperties({[`${end}Level`]: Number(level.value)});
  };
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
  if (!isDrawn || edit.isNew || !canNameJunctions(edit.context.rules)) return;
  const heading = createElementWithText('h3', isRing(edit.feature) ? 'Where the ring begins' : 'Ends');
  heading.className = 'section-title';
  // A ring starts and ends at one junction, whose levels are set there.
  const rows = isRing(edit.feature) ? [endRow('start', edit)] : [endRow('start', edit), endRow('end', edit)];
  container.append(heading, ...rows);
}

const endMarks = feature => {
  if (!(feature.geometry?.coordinates.length > 1)) return [];
  const [start, end] = endsOf(feature);
  if (isRing(feature)) return [{coordinate: start, label: endLabels.start}];
  return [{coordinate: start, label: endLabels.start}, {coordinate: end, label: endLabels.end}];
};

const joinedPoints = (entry, context) => sharedPointsOf(entry, context.entriesOf(roadsFile));

// The open edit with the points that were disconnected in it.
const graphEdit = edit =>
  ({...edit, freePoints: new Set([...(edit.extras?.freePoints ?? []), ...(edit.extras?.disconnectedPoints ?? [])])});

// Takes the picked point out of its joint, so that it moves alone from then on.
function disconnectTool(feature, handle, edit) {
  const coordinate = handle && feature.geometry.coordinates[handle.vertexIndex];
  const isJoined = coordinate && joinedPoints(edit, edit.context).some(point => pointKey(point) === pointKey(coordinate));
  return {
    id: 'vertex-disconnect',
    label: 'Disconnect',
    isDisabled: !isJoined,
    run: () => {
      const problem = disconnectProblem(feature, handle.vertexIndex);
      if (problem) return edit.showProblem(problem);
      const disconnectedPoints = [...(edit.extras.disconnectedPoints ?? []), pointKey(coordinate)];
      edit.setExtras({disconnectedPoints});
      return edit.setFeature(disconnectedRoad(feature, handle.vertexIndex));
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
      if (edit.hasUnappliedEdit()) return edit.showProblem('Apply or Cancel this edit before you split the road.');
      const {context, key} = edit;
      const secondKey = `local:${crypto.randomUUID()}`;
      const {edits, problem} = rulesAfterSplit(context.entriesOf(restrictionsFile), {key, feature}, secondKey);
      if (problem) return edit.showProblem(problem);
      const ruleEdits = edits.map(({entry: {filename, key: ruleKey, feature: rule}, renamed}) => ({
        filename,
        key: ruleKey,
        after: {...rule, properties: {...rule.properties, ...renamed(rule.properties)}}
      }));
      const [first, second] = splitRoad(feature, handle.vertexIndex, context.rules.layers[roadsFile].properties, splitJunction(feature, handle, edit));
      const halves = [{filename: roadsFile, key, after: first}, {filename: roadsFile, key: secondKey, after: second}];
      return edit.replaceWith([...halves, ...ruleEdits], `Split · ${roadName(feature)}`);
    }
  };
}

// The junction where the halves of a road meet: that of the roads already ending there, or a new one.
function splitJunction(feature, {vertexIndex}, {context, key}) {
  if (!canNameJunctions(context.rules)) return null;
  const level = levelAt(feature, vertexIndex);
  const others = membersAt(feature.geometry.coordinates[vertexIndex], context.entriesOf(roadsFile), new Set([key]));
  const node = nodeOf(others.filter(member => member.level === level));
  return {level, node: node ?? `local:${crypto.randomUUID()}`};
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

// The road graph is the desk's work.
function roadVertexTools(feature, handle, edit) {
  if (edit.isNew || edit.context.isPhone()) return [];
  const split = splitTool(feature, handle, edit);
  return canNameJunctions(edit.context.rules) ? [disconnectTool(feature, handle, edit), split] : [split];
}

function preparedRoad(feature, context, edit) {
  if (!canNameJunctions(context.rules) || !feature.geometry) return feature;
  const before = context.session.workingFeature(roadsFile, edit.key);
  return roadWithEnds(graphEdit({...edit, feature, before}), context);
}

const roadCompanions = (edit, context) => companionsOfRoad(graphEdit(edit), context);

export const roadBehaviors = {
  [roadsFile]: {
    kind: ({properties}) => `Road · ${valueLabel('kind', properties.kind ?? 'new')}`,
    title: roadName,
    sections: roadSections,
    controls: () => ({kind: kindControl}),
    tools: (_feature, edit) => (edit.isNew ? [] : [{label: 'Join roads', isDesktopOnly: true, run: () => joinWithPicked(edit)}]),
    vertexTools: roadVertexTools,
    snappedPoint: ({lngLat}, context) => joinedRoadPoint(lngLat.toArray(), context),
    limitedGeometry: snappedWhileDragged,
    joinsLines: true,
    hasMagnet: () => true,
    measures: lengthFacts,
    renderExtras: renderEnds,
    marks: endMarks,
    joinedPoints,
    prepared: preparedRoad,
    problem: (edit, context) => roadCompanions(edit, context).problem,
    companionEdits: (edit, context) => roadCompanions(edit, context).edits,
    deletion: roadDeletion
  },
  [nodesFile]: {
    sections: () => [{title: 'Junction', fields: ['kind', 'crossing', 'traffic_signals']}]
  }
};
