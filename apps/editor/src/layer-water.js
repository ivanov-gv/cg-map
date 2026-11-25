// Water areas with their islands, rivers as lines that point downstream, and the coastline that the sea follows.
import {createElementWithText} from './dom.js';
import {valueLabel} from './field-catalog.js';
import {formatLength, lineLengthMetres, nearestPointOnLine} from './geometry-measures.js';
import {areaFacts, holeTool, renderHoles} from './layer-green.js';
import {joiningPoint, withoutJoin, withPoint} from './line-joining.js';
import {boundsAround, entriesWithin, pointKey} from './road-graph.js';
import {endsOf, isSamePoint} from './road-shapes.js';
import {changedStretch, crossesItself, followingEdits, hasOutlineAlong} from './shared-shapes.js';
import {
  flowsInto,
  isWaterway,
  joinableWater,
  joinedWaterPoints,
  linesKeepingJoins,
  linesTouched,
  riverEndingOnShores,
  riversKeepingShore
} from './water-joins.js';

const waterFile = 'water.geojson';
const landFile = 'land.geojson';
const bordersFile = 'border-edges.geojson';
const municipalitiesFile = 'municipalities.geojson';
const areaKinds = ['lake', 'river', 'reservoir', 'pond', 'basin', 'water'];
const lineKinds = ['river', 'stream', 'canal', 'ditch', 'drain'];
// The sea and the land outlines were simplified apart from the coastline, so they only run near it.
const coastToleranceMetres = 60;

const isCoastline = ({properties}) => properties.kind === 'coastline';
const isLine = ({geometry}) => geometry?.type === 'LineString';
const isFollowingLand = ({feature}) => feature.properties.kind === 'country';
const isSea = ({feature}) => feature.properties.kind === 'ocean';
const isSeaBorder = ({feature}) => [feature.properties.left, feature.properties.right].includes('sea');

// The sea is everything beyond the coastline, and the land and its borders end at it: each with a name for the message.
const coastFollowers = context => [
  {name: 'sea', entries: context.entriesOf(waterFile).filter(isSea)},
  {name: 'country', entries: context.entriesOf(landFile).filter(isFollowingLand)},
  {name: 'sea border', entries: context.entriesOf(bordersFile).filter(isSeaBorder)},
  {name: 'municipality', entries: context.entriesOf(municipalitiesFile)}
];

let latestFollowing = null;

// What follows a coastline change, by group: [{name, edits, isLeftBehind}]. Apply asks for it twice, and finding it takes
// a moment, so the latest answer is kept.
function coastFollowing(before, after, context) {
  const isKnown = latestFollowing?.before === before.geometry && latestFollowing.after === after.geometry;
  if (isKnown) return latestFollowing.groups;
  const stretch = changedStretch(before.geometry.coordinates, after.geometry.coordinates);
  const groups = !stretch
    ? []
    : coastFollowers(context).map(({name, entries}) => {
        const edits = followingEdits(entries, stretch, coastToleranceMetres);
        const mustFollow = () => name === 'sea' || hasOutlineAlong(entries, stretch, coastToleranceMetres);
        return {name, edits, isLeftBehind: edits.length === 0 && mustFollow()};
      });
  latestFollowing = {before: before.geometry, after: after.geometry, groups};
  return groups;
}

const coastEdits = (before, after, context) => coastFollowing(before, after, context).flatMap(({edits}) => edits);

// Where a border between municipalities, or with a neighbour, meets the sea, more than one outline shares the point. It
// would be left out of those that do not follow, so the stretch that moves must not contain one.
function hasBorderMeetingSea(before, after, context) {
  const stretch = changedStretch(before.geometry.coordinates, after.geometry.coordinates);
  if (!stretch) return false;
  // The ends of the stretch stay where they are, unless the line itself ends there and was moved.
  const stayingEnds = [
    [stretch.before[0], stretch.after[0]],
    [stretch.before.at(-1), stretch.after.at(-1)]
  ].filter(([from, to]) => isSamePoint(from, to));
  const isStaying = point => stayingEnds.some(([end]) => isSamePoint(end, point));
  const inlandBorders = context.entriesOf(bordersFile).filter(entry => !isSeaBorder(entry));
  return inlandBorders
    .flatMap(({feature}) => endsOf(feature))
    .some(end => {
      const {coordinate, distanceMetres} = nearestPointOnLine(end, stretch.before);
      return distanceMetres <= coastToleranceMetres && !isStaying(coordinate);
    });
}

// A shape that runs along the coast and cannot follow it would leave a gap between land and sea, so Apply refuses that.
function coastProblem({feature, before}, context) {
  if (!before || !isCoastline(feature)) return null;
  const behind = coastFollowing(before, feature, context).find(({isLeftBehind}) => isLeftBehind);
  if (hasBorderMeetingSea(before, feature, context)) return 'A border meets the sea here, so this point stays.';
  if (behind) return `The ${behind.name} cannot follow this change. Move fewer points, or points farther from the ends.`;
  const isCrossing =
    crossesItself(before.geometry, feature.geometry) ||
    coastEdits(before, feature, context).some(({filename, key, after}) =>
      crossesItself(context.session.workingFeature(filename, key).geometry, after.geometry)
    );
  return isCrossing ? 'The coast, or a shape that follows it, would cross itself here.' : null;
}

// The open edit of a line as joins need it: where its points were, and which of them were disconnected.
const joinFacts = ({origins, extras}) => ({origins: origins ?? undefined, freePoints: new Set(extras?.freePoints ?? [])});

// What other lines become, step by step: a line can move along and be touched in one edit.
function editsInSteps(entries, steps) {
  const editByKey = new Map();
  for (const step of steps) {
    const current = entries.map(entry => (editByKey.has(entry.key) ? {...entry, feature: editByKey.get(entry.key).after} : entry));
    for (const edit of step(current)) editByKey.set(edit.key, edit);
  }
  return [...editByKey.values()];
}

function lineEdits(edit, waterEntries) {
  const {key, feature, before} = edit;
  const [previous, next] = [before.geometry, feature.geometry];
  const keepJoins = entries => linesKeepingJoins(key, previous, next, entries, joinFacts(edit));
  if (isCoastline(feature)) return editsInSteps(waterEntries, [keepJoins, entries => riversKeepingShore(previous, next, entries)]);
  return editsInSteps(waterEntries, [keepJoins, entries => linesTouched(key, previous, next, entries)]);
}

function waterEdits(edit, context) {
  const {key, feature, before} = edit;
  const waterEntries = context.entriesOf(waterFile);
  if (!before) return isLine(feature) ? linesTouched(key, null, feature.geometry, waterEntries) : [];
  if (JSON.stringify(before.geometry) === JSON.stringify(feature.geometry)) return [];
  if (feature.geometry.type === 'Polygon') return riversKeepingShore(before.geometry, feature.geometry, waterEntries);
  if (!isLine(feature)) return [];
  const edits = lineEdits(edit, waterEntries);
  if (!isCoastline(feature)) return edits;
  const following = coastEdits(before, feature, context);
  // The shapes it was found for are about to change.
  latestFollowing = null;
  return [...edits, ...following];
}

// The water close to a point on the screen, for joining it.
const joinTargets = (coordinate, {map, entriesOf}) => entriesWithin(entriesOf(waterFile), boundsAround(coordinate, map));

// A drawn river joins the waterway or the shore it is put on.
function drawnWaterPoint({lngLat}, context, feature) {
  if (feature.geometry?.type !== 'LineString') return null;
  const coordinate = lngLat.toArray();
  return joiningPoint(coordinate, joinableWater(coordinate, joinTargets(coordinate, context), new Set(), true), context);
}

// Where the dragged point was when the edit was opened, or null when it was added since.
function originOfPoint(index, {key, feature, origins}, context) {
  const before = context.session.workingFeature(waterFile, key) ?? feature;
  const origin = origins ? origins[index] : index;
  return Number.isInteger(origin) ? before.geometry.coordinates[origin] : null;
}

function snappedWhileDragged(geometry, change, context) {
  const index = geometry.type === 'LineString' && !isCoastline(change.feature) ? change.draggedIndex : null;
  if (index === null) return geometry;
  const coordinate = geometry.coordinates[index];
  const targets = joinTargets(coordinate, context);
  const origin = originOfPoint(index, change, context);
  const isSharing = ({feature}) => feature.geometry.coordinates.some(point => isSamePoint(point, origin));
  // What is joined here moves along, so the point does not stick to where it was.
  const along = origin ? targets.filter(entry => isWaterway(entry) && isSharing(entry)) : [];
  const ignored = new Set([change.key, ...along.map(({key}) => key)]);
  const isEnd = index === 0 || index === geometry.coordinates.length - 1;
  const joined = joiningPoint(coordinate, joinableWater(coordinate, targets, ignored, isEnd), context);
  return joined ? withPoint(geometry, index, joined) : geometry;
}

// Takes the picked point out of its join, so that it moves alone from then on.
function waterVertexTools(feature, handle, edit) {
  // Joins are taken apart at the desk, as those of roads are.
  const canDisconnect = !edit.isNew && isLine(feature) && !isCoastline(feature) && !edit.context.isPhone();
  if (!canDisconnect) return [];
  const coordinate = handle && feature.geometry.coordinates[handle.vertexIndex];
  const joinedKeys = joinedWaterPoints(edit, edit.context.entriesOf(waterFile)).map(pointKey);
  const disconnect = () => {
    const geometry = withoutJoin(feature.geometry, handle.vertexIndex);
    if (!geometry) return edit.showProblem('This line is too short to be pulled back.');
    edit.setExtras({freePoints: [...(edit.extras.freePoints ?? []), pointKey(coordinate)]});
    return edit.setGeometry(geometry);
  };
  const isDisabled = !coordinate || !joinedKeys.includes(pointKey(coordinate));
  return [{id: 'vertex-disconnect', label: 'Disconnect', isDisabled, run: disconnect}];
}

function preparedWater(feature, context, edit) {
  if (!isLine(feature) || isCoastline(feature)) return feature;
  const before = context.session.workingFeature(waterFile, edit.key);
  const geometry = riverEndingOnShores(before?.geometry, feature.geometry, context.entriesOf(waterFile), joinFacts(edit));
  return {...feature, geometry};
}

// Only the kinds that fit the shape: a lake is no line.
function kindControl({feature}) {
  return value => {
    const select = document.createElement('select');
    select.name = 'kind';
    const kinds = isLine(feature) ? lineKinds : areaKinds;
    const values = new Set([...(value === undefined ? [''] : [value]), ...kinds]);
    for (const kind of values) {
      const option = createElementWithText('option', kind === '' ? 'Choose…' : valueLabel('kind', kind));
      option.value = kind;
      select.append(option);
    }
    select.value = value ?? '';
    return select;
  };
}

function waterTools(feature, edit) {
  if (!isLine(feature)) return holeTool('Cut an island')(feature, edit);
  if (isCoastline(feature)) return [];
  const reverse = () =>
    edit.setGeometry({...feature.geometry, coordinates: feature.geometry.coordinates.toReversed()});
  return [{label: 'Reverse flow', run: reverse}];
}

function renderWaterExtras(container, edit) {
  const {feature, context, key} = edit;
  renderHoles('Island')(container, edit);
  if (!isLine(feature) || feature.geometry.coordinates.length < 2) return;
  if (isCoastline(feature)) {
    const note = createElementWithText('p', 'The sea is everything beyond this line. Move it and the sea follows.');
    note.className = 'hint';
    container.append(note);
    return;
  }
  const target = flowsInto({key, feature}, context.entriesOf(waterFile));
  const targetName = target ? target.feature.properties.name || valueLabel('kind', target.feature.properties.kind) : 'nothing yet';
  container.append(createElementWithText('p', `Flows into ${targetName}`));
}

function waterFacts(feature, before) {
  if (!isLine(feature)) return areaFacts(feature, before);
  return feature.geometry.coordinates.length > 1 ? [`Length ${formatLength(lineLengthMetres(feature.geometry.coordinates))}`] : [];
}

const kindLabels = feature => {
  if (isCoastline(feature)) return 'Coastline';
  return isLine(feature) ? 'Water line' : 'Water area';
};

export const waterBehaviors = {
  [waterFile]: {
    kind: kindLabels,
    title: feature => feature.properties.name || valueLabel('kind', feature.properties.kind ?? 'water'),
    sections: feature => [{title: 'Type and name', fields: isCoastline(feature) ? ['name', 'name:en'] : ['kind', 'name', 'name:en']}],
    controls: edit => ({kind: kindControl(edit)}),
    tools: waterTools,
    renderExtras: renderWaterExtras,
    prepared: preparedWater,
    snappedPoint: drawnWaterPoint,
    limitedGeometry: snappedWhileDragged,
    joinsLines: true,
    hasMagnet: feature => !isCoastline(feature),
    vertexTools: waterVertexTools,
    joinedPoints: (entry, context) => joinedWaterPoints(entry, context.entriesOf(waterFile)),
    problem: coastProblem,
    deletion: ({feature}) =>
      isCoastline(feature)
        ? {problem: 'The sea, the country and its borders end at the coastline, so it cannot be deleted.'}
        : {message: '', edits: []},
    companionEdits: waterEdits,
    measures: waterFacts
  }
};
