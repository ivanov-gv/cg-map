// Water areas with their islands, rivers as lines that point downstream, and the coastline that the sea follows.
import {createElementWithText} from './dom.js';
import {valueLabel} from './field-catalog.js';
import {formatLength, lineLengthMetres} from './geometry-measures.js';
import {areaFacts, holeTool, renderHoles} from './layer-green.js';
import {changedStretch, crossesItself, followingEdits, hasOutlineAlong} from './shared-shapes.js';
import {flowsInto, linesKeepingJoins, riverEndingOnShores, riversKeepingShore} from './water-joins.js';

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

function coastEdits(before, after, context) {
  const stretch = changedStretch(before.geometry.coordinates, after.geometry.coordinates);
  if (!stretch) return [];
  return coastFollowers(context).flatMap(({entries}) => followingEdits(entries, stretch, coastToleranceMetres));
}

// A shape that runs along the coast and cannot follow it would leave a gap between land and sea, so Apply refuses that.
function coastProblem({feature, before}, context) {
  if (!before || !isCoastline(feature)) return null;
  const stretch = changedStretch(before.geometry.coordinates, feature.geometry.coordinates);
  if (!stretch) return null;
  const behind = coastFollowers(context).find(({name, entries}) => {
    const mustFollow = name === 'sea' || hasOutlineAlong(entries, stretch, coastToleranceMetres);
    return mustFollow && followingEdits(entries, stretch, coastToleranceMetres).length === 0;
  });
  if (behind) return `The ${behind.name} cannot follow this change. Move fewer points, or points farther from the ends.`;
  const isCrossing =
    crossesItself(before.geometry, feature.geometry) ||
    coastEdits(before, feature, context).some(({filename, key, after}) =>
      crossesItself(context.session.workingFeature(filename, key).geometry, after.geometry)
    );
  return isCrossing ? 'The coast, or a shape that follows it, would cross itself here.' : null;
}

function waterEdits({key, feature, before}, context) {
  if (!before || JSON.stringify(before.geometry) === JSON.stringify(feature.geometry)) return [];
  const waterEntries = context.entriesOf(waterFile);
  if (isLine(feature)) {
    const joins = linesKeepingJoins(key, before.geometry, feature.geometry, waterEntries);
    return isCoastline(feature) ? [...joins, ...coastEdits(before, feature, context)] : joins;
  }
  if (feature.geometry.type !== 'Polygon') return [];
  return riversKeepingShore(before.geometry, feature.geometry, waterEntries);
}

function preparedWater(feature, context, {key}) {
  if (!isLine(feature) || isCoastline(feature)) return feature;
  const before = context.session.workingFeature(waterFile, key);
  return {...feature, geometry: riverEndingOnShores(before?.geometry, feature.geometry, context.entriesOf(waterFile))};
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
    problem: coastProblem,
    companionEdits: waterEdits,
    measures: waterFacts
  }
};
