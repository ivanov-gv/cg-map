// Roads and paths: drawing that joins what it touches, splitting and joining, who may use a road, and at the desk the
// road graph with its levels, turns and traffic lights.
import {createElementWithText} from './dom.js';
import {valueLabel} from './field-catalog.js';
import {roundedCoordinate} from './geometry-editing.js';
import {formatLength, lineLengthMetres, nearestPointOnLine} from './geometry-measures.js';
import {
  isOnWay,
  restrictionFor,
  rulesLostBySplit,
  trafficLightAt,
  turnRule,
  turnsAtEnd,
  wayNumber
} from './road-junctions.js';
import {endsOf, isSamePoint, joinedRoad, splitProblem, splitRoad, withJunctionAt} from './road-shapes.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
const joinDistancePixels = 12;
// A drawn point was put exactly on the other road, so only rounding can keep them apart.
const junctionToleranceMetres = 0.2;
const longestLinkMetres = 500;

const kindGroups = [
  ['Streets', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']],
  ['Links (ramps)', ['motorway_link', 'trunk_link', 'primary_link', 'secondary_link']],
  ['Walking and cycling', ['pedestrian', 'footway', 'path', 'track', 'cycleway', 'steps']]
];
const accessValues = ['yes', 'no', 'designated', 'permissive', 'destination', 'private'];
const turnLabels = {left: 'Left', right: 'Right', straight: 'Straight on', uTurn: 'U-turn'};

const roadName = ({properties}) => properties.name?.trim() || valueLabel('kind', properties.kind ?? 'road');

// Whether the box around a road overlaps the view; the exact distance is computed only for those.
function mayCross(coordinates, bounds) {
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  return (
    Math.max(...longitudes) >= bounds.getWest() &&
    Math.min(...longitudes) <= bounds.getEast() &&
    Math.max(...latitudes) >= bounds.getSouth() &&
    Math.min(...latitudes) <= bounds.getNorth()
  );
}

// The nearest road under the pointer, so that a click on it joins it there.
function nearestRoadPoint(event, {map, entriesOf}) {
  const coordinate = event.lngLat.toArray();
  const bounds = map.getBounds();
  let nearest = null;
  for (const {feature} of entriesOf(roadsFile)) {
    const {coordinates} = feature.geometry;
    if (!mayCross(coordinates, bounds)) continue;
    const candidate = nearestPointOnLine(coordinate, coordinates);
    if (!nearest || candidate.distanceMetres < nearest.distanceMetres) nearest = {...candidate, coordinates};
  }
  if (!nearest) return null;
  const isWithinReach = position => event.point.dist(map.project(position)) <= joinDistancePixels;
  // An existing point is joined rather than a new one beside it.
  const existingPoint = nearest.coordinates.find(isWithinReach);
  if (existingPoint) return existingPoint;
  return isWithinReach(nearest.coordinate) ? roundedCoordinate(nearest.coordinate) : null;
}

// Other roads get a point where a new or reshaped road touches them.
function junctionEdits({key, feature, before}, context) {
  const isKnownPoint = point => before?.geometry.coordinates.some(known => isSamePoint(known, point));
  const newPoints = feature.geometry.coordinates.filter(point => !isKnownPoint(point));
  if (newPoints.length === 0) return [];
  const edits = [];
  for (const road of context.entriesOf(roadsFile)) {
    if (road.key === key) continue;
    let next = road.feature;
    for (const point of newPoints) next = withJunctionAt(next, point, junctionToleranceMetres) ?? next;
    if (next !== road.feature) edits.push({filename: roadsFile, key: road.key, after: next});
  }
  return edits;
}

function restrictionEdit(road, turn, isForbidden, context) {
  const fromWay = wayNumber(road.feature.properties.entityId);
  const toWay = wayNumber(turn.road.feature.properties.entityId);
  const junctionNode = road.feature.properties.endNode;
  const {recorded, onlyRule} = turnRule(context.entriesOf(restrictionsFile), fromWay, toWay, junctionNode);
  if (onlyRule || Boolean(recorded) === isForbidden) return [];
  if (recorded) return [{filename: restrictionsFile, key: recorded.key, after: null}];
  const properties = {restriction: restrictionFor(turn.kind), from: fromWay, to: toWay, viaNodes: [junctionNode]};
  const key = `local:${crypto.randomUUID()}`;
  return [{filename: restrictionsFile, key, after: {type: 'Feature', properties, geometry: null}}];
}

function trafficLightEdit({feature}, hasLight, context) {
  const [, junction] = endsOf(feature);
  const light = trafficLightAt(context.entriesOf(nodesFile), junction);
  if (Boolean(light) === hasLight) return [];
  if (light) return [{filename: nodesFile, key: light.key, after: null}];
  const geometry = {type: 'Point', coordinates: junction};
  const after = {type: 'Feature', properties: {kind: 'traffic_signals'}, geometry};
  return [{filename: nodesFile, key: `local:${crypto.randomUUID()}`, after}];
}

// What was chosen in the junction controls, recorded with the road.
function junctionChoiceEdits({key, feature, extras}, context) {
  const road = {key, feature};
  const turns = turnsAtEnd(road, context.entriesOf(roadsFile));
  const turnEdits = turns.flatMap(turn => {
    const choice = extras[`turn:${turn.road.key}`];
    return choice === undefined ? [] : restrictionEdit(road, turn, choice, context);
  });
  const lightEdits = extras.hasLight === undefined ? [] : trafficLightEdit(road, extras.hasLight, context);
  return [...turnEdits, ...lightEdits];
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
  return [road, access, driving, {title: 'Ends and direction', fields: ['oneway', 'startLevel', 'endLevel']}, more];
}

function checkbox(label, isChecked, onChange) {
  const element = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = isChecked;
  input.onchange = () => onChange(input.checked);
  element.className = 'choice-row';
  element.append(input, ` ${label}`);
  return element;
}

// Turns can be recorded only between roads that have an OSM identity and meet at an OSM node.
function turnRow(road, turn, edit) {
  const {context} = edit;
  const fromWay = wayNumber(road.feature.properties.entityId);
  const toWay = wayNumber(turn.road.feature.properties.entityId);
  const junctionNode = road.feature.properties.endNode;
  if (!fromWay || !toWay || !junctionNode) return null;
  const rule = turnRule(context.entriesOf(restrictionsFile), fromWay, toWay, junctionNode);
  const choiceName = `turn:${turn.road.key}`;
  const isForbidden = edit.extras[choiceName] ?? rule.isForbidden;
  const target = turn.kind === 'uTurn' ? '' : ` onto ${roadName(turn.road.feature)}`;
  const row = checkbox(`${turnLabels[turn.kind]}${target} allowed`, !isForbidden, isAllowed =>
    edit.setExtras({[choiceName]: !isAllowed})
  );
  if (rule.onlyRule) {
    const {restriction} = rule.onlyRule.feature.properties;
    row.querySelector('input').disabled = true;
    row.append(` · rule of the junction: ${restriction.replaceAll('_', ' ')}`);
  }
  return row;
}

// The junction at the end of the road, at the desk only. Arrows on the map follow start to end.
function renderJunction(container, edit) {
  const {context, key, feature} = edit;
  const isDrawn = feature.geometry?.coordinates.length > 1;
  if (context.isPhone() || !isDrawn) return;
  const road = {key, feature};
  const rows = turnsAtEnd(road, context.entriesOf(roadsFile))
    .map(turn => turnRow(road, turn, edit))
    .filter(Boolean);
  const [, junction] = endsOf(feature);
  const hasLight = edit.extras.hasLight ?? Boolean(trafficLightAt(context.entriesOf(nodesFile), junction));
  const heading = createElementWithText('h3', 'Junction at the end');
  heading.className = 'section-title';
  container.append(heading, checkbox('Traffic light', hasLight, isChecked => edit.setExtras({hasLight: isChecked})));
  if (rows.length > 0) container.append(...rows);
  else {
    const note = createElementWithText('p', 'Turns need roads that already have an OSM node here.');
    note.className = 'hint';
    container.append(note);
  }
}

// At the desk a road can be split at its picked point. Both halves are one step.
function splitTool(feature, handle, edit) {
  return {
    id: 'vertex-split',
    label: 'Split here',
    isDisabled: !handle || Boolean(splitProblem(feature, handle.vertexIndex)),
    run: () => {
      const {context} = edit;
      if (rulesLostBySplit(context.entriesOf(restrictionsFile), feature).length > 0) {
        edit.showProblem('This road has turn rules at its end, which a split would lose. Remove them first.');
        return;
      }
      const [first, second] = splitRoad(feature, handle.vertexIndex, context.rules.layers[roadsFile].properties);
      edit.setFeature(first);
      edit.applyWith([{filename: roadsFile, key: `local:${crypto.randomUUID()}`, after: second}]);
    }
  };
}

// Turn rules of either road that a join would break: the other road's way is gone, and so is the junction between them.
function hasRulesLostByJoin(feature, other, context) {
  const restrictions = context.entriesOf(restrictionsFile);
  const otherWay = wayNumber(other.properties.entityId);
  const way = wayNumber(feature.properties.entityId);
  const [, end] = endsOf(feature);
  const isJoinedAtEnd = endsOf(other).some(point => isSamePoint(point, end));
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
  if (hasRulesLostByJoin(feature, other.feature, context)) {
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
function roadDeletion({feature}, context) {
  const way = wayNumber(feature.properties.entityId);
  const restrictions = way ? context.entriesOf(restrictionsFile).filter(restriction => isOnWay(restriction, way)) : [];
  return {
    message: restrictions.length > 0 ? `${restrictions.length} turn rules go with it.` : '',
    edits: restrictions.map(({filename, key}) => ({filename, key, after: null}))
  };
}

export const roadBehaviors = {
  [roadsFile]: {
    kind: ({properties}) => `Road · ${valueLabel('kind', properties.kind ?? 'new')}`,
    title: roadName,
    sections: roadSections,
    controls: () => ({kind: kindControl}),
    suggestions: () => ({
      motor_vehicle: accessValues,
      foot: accessValues,
      bicycle: accessValues,
      access: accessValues,
      oneway: ['yes', 'no', '-1'],
      maxspeed: ['20', '30', '40', '50', '60', '80', '100'],
      surface: ['asphalt', 'paving_stones', 'concrete', 'gravel', 'ground']
    }),
    tools: (_feature, edit) => (edit.isNew ? [] : [{label: 'Join roads', isDesktopOnly: true, run: () => joinWithPicked(edit)}]),
    vertexTools: (feature, handle, edit) => (edit.context.isPhone() || edit.isNew ? [] : [splitTool(feature, handle, edit)]),
    snappedPoint: nearestRoadPoint,
    measures: lengthFacts,
    renderExtras: renderJunction,
    companionEdits: (edit, context) => [...junctionEdits(edit, context), ...junctionChoiceEdits(edit, context)],
    deletion: roadDeletion
  },
  [nodesFile]: {
    sections: () => [{title: 'Junction', fields: ['kind', 'crossing', 'traffic_signals']}]
  }
};
