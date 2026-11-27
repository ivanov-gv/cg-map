import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {crossesContours, highestContourAround, isClosedLine, keptClosed} from '../src/layers/relief/contour-rules.js';
import {reliefBehaviors} from '../src/layers/relief/layer-relief.js';
import {validateRidgeTopology} from '../src/layers/relief/ridge-topology.js';
import {greenKinds} from '../src/source-data/derived-facts.js';
import {editorLayers} from '../src/layers/shared/editor-layers.js';
import {drawChoicesOf} from '../src/layers/shared/layer-behaviors.js';
import {settlementBehaviors} from '../src/layers/settlements/layer-settlements.js';
import {pinnedContractsRoot} from './pinned-contracts.mjs';

const fixtureRules = JSON.parse(readFileSync(new URL('fixtures/editor-layers.json', import.meta.url), 'utf8'));
const pinnedRules = JSON.parse(readFileSync(path.join(pinnedContractsRoot, 'editor-layers.json'), 'utf8'));

const step = 0.001;
const at = ([east, north]) => [19 + east * step, 42 + north * step];
const points = (...steps) => steps.map(at);
const ringOf = (...steps) => points(...steps, steps[0]);
const feature = (properties, geometry) => ({type: 'Feature', properties, geometry});
const contour = (elevation, ...steps) =>
  feature({kind: 'contour', elevation}, {type: 'LineString', coordinates: ringOf(...steps)});
const outer = contour(40, [0, 0], [10, 0], [10, 10], [0, 10]);
const inner = contour(60, [2, 2], [8, 2], [8, 8], [2, 8]);

function contextWith(featuresByFile) {
  const entriesOf = filename =>
    (featuresByFile[filename] ?? []).map((entry, index) => ({filename, key: String(index), feature: entry}));
  return {
    entriesOf,
    session: {
      workingFeature: (filename, key) => entriesOf(filename).find(entry => entry.key === key)?.feature ?? null
    },
    findEntity: (filename, entityId) => entriesOf(filename).find(entry => entry.feature.properties.entityId === entityId)
  };
}

test('a changed contour must not meet another line or itself, and unchanged parts are not judged again', () => {
  const before = inner.geometry.coordinates;
  const others = [outer.geometry.coordinates];
  const within = ringOf([2, 2], [9, 1], [8, 8], [2, 8]);
  const beyond = ringOf([2, 2], [11, 1], [8, 8], [2, 8]);
  assert.equal(crossesContours(within, before, others), false);
  assert.equal(crossesContours(beyond, before, others), true);
  assert.equal(crossesContours(beyond, beyond, others), false, 'a source line that already crosses can be renamed');
  const bowTie = points([0, 0], [2, 2], [2, 0], [0, 2]);
  assert.equal(crossesContours(bowTie, null, []), true);
});

test('a dragged contour point stops at the next line, and both ends of a closed line move together', () => {
  const context = contextWith({'contours.geojson': [outer, inner]});
  const {limitedGeometry} = reliefBehaviors['contours.geojson'];
  const previousGeometry = inner.geometry;
  const moved = coordinates => ({type: 'LineString', coordinates});
  const beyond = moved(points([-1, 2], [8, 2], [8, 8], [2, 8], [2, 2]));
  const stopped = limitedGeometry(beyond, {key: '1', previousGeometry}, context).coordinates[0];
  const [westmost] = outer.geometry.coordinates[0];
  assert.ok(stopped[0] > westmost && stopped[0] - westmost < 0.1 * step, 'it stops just before the line');
  const within = limitedGeometry(moved(points([1, 1], [8, 2], [8, 8], [2, 8], [2, 2])), {key: '1', previousGeometry}, context);
  assert.deepEqual(within.coordinates.at(-1), at([1, 1]));
  assert.ok(isClosedLine(within.coordinates));
  const open = points([0, 0], [1, 1]);
  assert.equal(keptClosed(open, open), open);
});

test('a contour says whether it is a main line, and a summit is higher than the contours around it', () => {
  const prepared = reliefBehaviors['contours.geojson'].prepared;
  assert.equal(prepared(contour(200, [0, 0])).properties.index, true);
  assert.equal(prepared(contour(220, [0, 0])).properties.index, false);
  const context = contextWith({'contours.geojson': [outer, inner]});
  const summit = (ele, position) => ({feature: feature({ele}, {type: 'Point', coordinates: at(position)})});
  assert.equal(highestContourAround(at([5, 5]), context.entriesOf('contours.geojson')), 60);
  const {problem} = reliefBehaviors['summits.geojson'];
  assert.match(problem(summit(60, [5, 5]), context), /higher than 60 m/);
  assert.equal(problem(summit(61, [5, 5]), context), null);
  assert.equal(problem(summit(1, [50, 50]), context), null);
});

test('a moved ridge recolours both slopes, and its ends stay on the outline of its hill', () => {
  const slope = (...steps) => feature({kind: 'slope'}, {type: 'Polygon', coordinates: [ringOf(...steps)]});
  const ridge = coordinates => feature({kind: 'ridge'}, {type: 'LineString', coordinates});
  const before = ridge(points([0, 5], [2, 5], [4, 5]));
  const context = {
    ...contextWith({
      'slopes.geojson': [
        slope([0, 0], [4, 0], [4, 5], [2, 5], [0, 5]),
        slope([0, 5], [2, 5], [4, 5], [4, 10], [0, 10])
      ]
    }),
    session: {workingFeature: () => before}
  };
  const {limitedGeometry, companionEdits} = reliefBehaviors['ridges.geojson'];
  const dragged = {type: 'LineString', coordinates: points([1, 6], [2, 6], [4, 6])};
  const limited = limitedGeometry(dragged, {key: '0', previousGeometry: before.geometry}, context);
  assert.deepEqual(limited.coordinates, points([0, 6], [2, 6], [4, 6]));
  const edits = companionEdits({feature: {...before, geometry: limited}, before}, context);
  assert.deepEqual(edits.map(({key}) => key), ['0', '1']);
  const hasCorner = ({after}, step) => after.geometry.coordinates[0].some(point => String(point) === String(at(step)));
  for (const edit of edits) assert.ok([[0, 6], [2, 6], [4, 6]].every(step => hasCorner(edit, step)));
  const movedMiddle = companionEdits({feature: ridge(points([0, 5], [2, 6], [4, 5])), before}, context);
  assert.deepEqual(movedMiddle.map(({key}) => key), ['0', '1']);
  for (const edit of movedMiddle) assert.ok(hasCorner(edit, [2, 6]));
});

test('a bundle without slopes slides a ridge end onto its green outline and records no slope edit', () => {
  const ridge = coordinates => feature({kind: 'ridge'}, {type: 'LineString', coordinates});
  const park = feature({kind: 'park'}, {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 10], [0, 10])]});
  const before = ridge(points([0, 5], [2, 5], [4, 5]));
  const context = {
    ...contextWith({'land.geojson': [park], 'ridges.geojson': [before]}),
    hasFile: filename => filename !== 'slopes.geojson',
    session: {workingFeature: () => before}
  };
  const behavior = reliefBehaviors['ridges.geojson'];
  const dragged = {type: 'LineString', coordinates: points([1, 6], [2, 6], [4, 6])};
  const limited = behavior.limitedGeometry(dragged, {key: '0', previousGeometry: before.geometry}, context);
  assert.deepEqual(limited.coordinates, points([0, 6], [2, 6], [4, 6]));
  const edit = {feature: {...before, geometry: limited}, before};
  assert.equal(behavior.problem(edit, context), null);
  assert.deepEqual(behavior.companionEdits(edit, context), []);
  const outlinePoint = at([0, 4]);
  const tappedNearOutline = [outlinePoint[0] + 0.000005, outlinePoint[1]];
  assert.deepEqual(
    behavior.snappedPoint(
      {lngLat: {toArray: () => tappedNearOutline}},
      context,
      {geometry: {coordinates: points([0, 5])}}
    ),
    outlinePoint
  );
});

test('a version-4 ridge must stay in one green area and end on its outline or another ridge', () => {
  const ridge = coordinates => feature({kind: 'ridge'}, {type: 'LineString', coordinates});
  const park = feature({kind: 'park'}, {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 10], [0, 10])]});
  const before = feature({kind: 'ridge', entityId: 'derived:ridge-1'}, {
    type: 'LineString',
    coordinates: points([0, 5], [2, 5], [4, 5])
  });
  const context = {
    ...contextWith({'land.geojson': [park], 'ridges.geojson': [before]}),
    hasFile: filename => filename !== 'slopes.geojson',
    session: {workingFeature: () => before}
  };
  const {problem} = reliefBehaviors['ridges.geojson'];
  const relocated = {feature: ridge(points([0, 12], [2, 12], [4, 12])), before};
  assert.equal(problem(relocated, context), 'Ridge: ridge is outside a green area');
  const loose = {feature: ridge(points([1, 4], [2, 4], [4, 4])), before};
  assert.equal(problem(loose, context), 'Ridge: ridge end is not on the green area outline or another ridge');
  const meeting = ridge(points([2, 0], [2, 5]));
  const withJunction = {
    ...context,
    entriesOf: filename => filename === 'ridges.geojson'
      ? [{filename, key: '0', feature: before}, {filename, key: '1', feature: meeting}]
      : context.entriesOf(filename)
  };
  assert.equal(problem({feature: ridge(points([0, 6], [2, 4])), before}, withJunction), null);
});

test('deleting a ridge that supports another one is refused only where slopes are derived', () => {
  const ridge = (entityId, coordinates) =>
    feature({kind: 'ridge', entityId}, {type: 'LineString', coordinates});
  const park = feature({kind: 'park'}, {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 10], [0, 10])]});
  const supporting = ridge('derived:ridge-1', points([0, 5], [4, 5]));
  const dependent = ridge('derived:ridge-2', points([2, 0], [2, 5]));
  const entries = [supporting, dependent];
  const context = {
    ...contextWith({'land.geojson': [park], 'ridges.geojson': entries}),
    hasFile: filename => filename !== 'slopes.geojson'
  };
  const {deletion} = reliefBehaviors['ridges.geojson'];
  const supportingEntry = {filename: 'ridges.geojson', key: '0', feature: supporting};
  assert.match(
    deletion(supportingEntry, context).problem,
    /^Deleting this ridge would leave derived:ridge-2: ridge end is not on the green area outline or another ridge\.$/
  );
  assert.deepEqual(deletion({...supportingEntry, key: '1', feature: dependent}, context), {message: '', edits: []});
  assert.deepEqual(deletion(supportingEntry, {...context, hasFile: () => true}), {message: '', edits: []});
});

test('the relief behavior derives slope previews only for a version-4 bundle', () => {
  const park = feature({kind: 'park'}, {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 10], [0, 10])]});
  const ridge = feature({kind: 'ridge'}, {type: 'LineString', coordinates: points([0, 5], [4, 5])});
  const context = {
    ...contextWith({'land.geojson': [park], 'ridges.geojson': [ridge]}),
    hasFile: filename => filename !== 'slopes.geojson'
  };
  const {derivedPreviews} = reliefBehaviors['ridges.geojson'];
  const previews = derivedPreviews(context)['slopes.geojson'];
  assert.deepEqual(previews.map(({properties}) => properties.aspect).sort(), ['shaded', 'sunlit']);
  assert.deepEqual(derivedPreviews({...context, hasFile: () => true}), {});
});

test('the topology check uses the tolerance it is given for ridge ends', () => {
  const park = feature({kind: 'park'}, {type: 'Polygon', coordinates: [ringOf([0, 0], [4, 0], [4, 10], [0, 10])]});
  const [east, north] = at([4, 5]);
  const ridge = feature({kind: 'ridge', entityId: 'derived:ridge-1'}, {
    type: 'LineString',
    coordinates: [at([0, 5]), [east - 0.000005, north]]
  });
  const land = {type: 'FeatureCollection', features: [park]};
  const ridges = {type: 'FeatureCollection', features: [ridge]};
  assert.equal(validateRidgeTopology(land, ridges, greenKinds), 1);
  assert.throws(
    () => validateRidgeTopology(land, ridges, greenKinds, {tolerance: 0.000001}),
    /derived:ridge-1: ridge end is not on the green area outline or another ridge/
  );
});

test('a ridge can be added and deleted under the pinned rules, but only a derived-slopes bundle offers Draw ridge', () => {
  assert.deepEqual(fixtureRules.layers['ridges.geojson'], pinnedRules.layers['ridges.geojson']);
  const relief = editorLayers.find(({id}) => id === 'relief');
  const hasSlopes = drawChoicesOf(relief, fixtureRules, {hasFile: () => true});
  const derived = drawChoicesOf(relief, fixtureRules, {hasFile: () => false});
  assert.equal(hasSlopes.some(({label}) => label === 'Draw ridge'), false);
  const choice = derived.find(({label}) => label === 'Draw ridge');
  assert.ok(choice);
  assert.deepEqual(choice.properties, {kind: 'ridge'});
});

test('a ridge end cannot be removed, but a point between its ends can', () => {
  const slope = (...steps) => feature({kind: 'slope'}, {type: 'Polygon', coordinates: [ringOf(...steps)]});
  const ridgeAt = coordinates => feature({kind: 'ridge'}, {type: 'LineString', coordinates});
  const before = ridgeAt(points([0, 5], [2, 5], [4, 5]));
  const context = {
    ...contextWith({
      'slopes.geojson': [
        slope([0, 0], [4, 0], [4, 5], [2, 5], [0, 5]),
        slope([0, 5], [2, 5], [4, 5], [4, 10], [0, 10])
      ]
    }),
    session: {workingFeature: () => before}
  };
  const behavior = reliefBehaviors['ridges.geojson'];
  for (const coordinates of [points([2, 5], [4, 5]), points([0, 5], [2, 5]), points([2, 5])]) {
    assert.match(
      behavior.problem({feature: ridgeAt(coordinates), before}, context),
      /end cannot be removed/,
      'an end is not a point to delete'
    );
  }
  assert.match(
    behavior.problem({feature: ridgeAt(points([0, 5], [4, 5])), before, origins: [1, 2]}, context),
    /end cannot be removed/,
    'an inner point that took the old place is not that end'
  );
  assert.equal(behavior.problem({feature: ridgeAt(points([0, 5], [4, 5])), before}, context), null);
});

const municipality = (code, name, ...steps) =>
  feature(
    {kind: 'municipality', 'ISO3166-2': code, name, entityId: `relation/${code}`},
    {type: 'Polygon', coordinates: [ringOf(...steps)]}
  );
const west = municipality('ME-01', 'West', [0, 0], [5, 0], [5, 5], [5, 10], [0, 10]);
const east = municipality('ME-02', 'East', [5, 0], [10, 0], [10, 10], [5, 10], [5, 5]);
const border = (left, right, coordinates) => feature({kind: 'border', left, right}, {type: 'LineString', coordinates});

test('a contour is lower than the summits inside it, unless it never was', () => {
  const summit = feature({name: 'Peak', ele: 70}, {type: 'Point', coordinates: at([5, 5])});
  const context = contextWith({'contours.geojson': [outer, inner], 'summits.geojson': [summit]});
  const {problem} = reliefBehaviors['contours.geojson'];
  const raised = elevation => ({...inner, properties: {...inner.properties, elevation}});
  assert.equal(problem({key: '1', feature: raised(60), before: inner}, context), null);
  assert.match(problem({key: '1', feature: raised(80), before: inner}, context), /Peak inside this line is 70 m/);
  assert.equal(problem({key: '1', feature: raised(100), before: raised(80)}, context), null, 'the sources had it so');
});

test('the height of the phone fills a gap of the same summit only', () => {
  const positions = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {geolocation: {getCurrentPosition: onPosition => positions.push(onPosition)}}
  });
  const recorded = [];
  const editOf = (ele, isOpen) => ({
    context: {isPhone: () => true},
    isOpen: () => isOpen,
    typedFeature: () => ({properties: {ele}}),
    setProperties: properties => recorded.push(properties),
    showMessage: () => {}
  });
  const {tools} = reliefBehaviors['summits.geojson'];
  const summit = {properties: {ele: null}};
  for (const edit of [editOf(null, true), editOf(null, false), editOf(812, true)]) tools(summit, edit)[0].run();
  for (const onPosition of positions) onPosition({coords: {altitude: 800.4}});
  assert.deepEqual(recorded, [{ele: 800}], 'neither a closed edit nor a height typed meanwhile is changed');
  assert.deepEqual(tools({properties: {ele: 812}}, editOf(812, true)), []);
});

test('a ridge is refused where no slope runs along it, and lines are not reshaped on a phone', () => {
  const ridgeBehavior = reliefBehaviors['ridges.geojson'];
  const before = feature({}, {type: 'LineString', coordinates: points([0, 0], [1, 1], [2, 0])});
  const after = {...before, geometry: {type: 'LineString', coordinates: points([0, 0], [1, 2], [2, 0])}};
  assert.match(ridgeBehavior.problem({feature: after, before}, contextWith({})), /cannot follow/);
  assert.equal(ridgeBehavior.isReshapable({isPhone: () => true}), false);
  assert.equal(reliefBehaviors['contours.geojson'].isReshapable({isPhone: () => false}), true);
});

test('a shared border moves both municipalities at once, and the coast is not a border to move', () => {
  const before = border('ME-01', 'ME-02', points([5, 0], [5, 5], [5, 10]));
  const context = contextWith({'municipalities.geojson': [west, east], 'border-edges.geojson': [before]});
  const behavior = settlementBehaviors['border-edges.geojson'];
  const after = {...before, geometry: {type: 'LineString', coordinates: points([5, 0], [6, 5], [5, 10])}};
  const edits = behavior.companionEdits({feature: after, before}, context);
  assert.deepEqual(edits.map(({key}) => key), ['0', '1']);
  const shared = String(at([6, 5]));
  for (const edit of edits) assert.ok(edit.after.geometry.coordinates[0].map(String).includes(shared));
  assert.equal(behavior.title(before, context), 'West | East');

  const elsewhere = border('ME-01', 'ME-02', points([50, 0], [50, 5], [50, 10]));
  const movedElsewhere = {...elsewhere, geometry: {type: 'LineString', coordinates: points([50, 0], [51, 5], [50, 10])}};
  assert.match(behavior.problem({feature: movedElsewhere, before: elsewhere}, context), /cannot follow/);
  assert.equal(behavior.problem({key: '0', feature: after, before}, context), null);
  const oneSide = contextWith({'municipalities.geojson': [west], 'border-edges.geojson': [before]});
  assert.match(behavior.problem({key: '0', feature: after, before}, oneSide), /cannot follow/, 'both sides must follow');

  const coast = border('sea', 'ME-01', points([0, 0], [0, 5], [0, 10]));
  const movedCoast = {...coast, geometry: {type: 'LineString', coordinates: points([0, 0], [1, 5], [0, 10])}};
  assert.match(behavior.problem({feature: movedCoast, before: coast}, context), /Water layer/);
  const limits = {feature: coast, previousGeometry: coast.geometry};
  assert.equal(behavior.limitedGeometry(movedCoast.geometry, limits), coast.geometry);
});

test('a town says which municipality it is in, and a neighbour has one name in both its shapes', () => {
  const context = contextWith({
    'municipalities.geojson': [west, east],
    'land.geojson': [
      feature({kind: 'context', entityId: 'ne:NBR', name: 'Old'}, {type: 'Polygon', coordinates: []}),
      feature({kind: 'context', entityId: 'ne:OTH', name: 'Other'}, {type: 'Polygon', coordinates: []})
    ]
  });
  const {prepared, problem} = settlementBehaviors['settlements.geojson'];
  const town = position => feature({kind: 'settlement', rank: 'town', name: 'New'}, {type: 'Point', coordinates: at(position)});
  const newTown = {key: 'local:1'};
  assert.equal(prepared(town([7, 5]), context, newTown).properties.municipality, 'ME-02');
  assert.equal(prepared(town([7, 5]), context, newTown).properties.place, 'town');
  const movedAway = town([50, 50]);
  movedAway.properties.municipality = 'ME-02';
  assert.match(problem({feature: prepared(movedAway, context, newTown)}), /inside a municipality/);
  const neighbour = feature({entityId: 'ne:NBR', name: 'New name'}, null);
  const [edit] = settlementBehaviors['context-countries.geojson'].companionEdits({feature: neighbour}, context);
  assert.deepEqual([edit.key, edit.after.properties.name], ['0', 'New name']);
});
