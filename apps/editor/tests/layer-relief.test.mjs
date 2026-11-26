import test from 'node:test';
import assert from 'node:assert/strict';
import {crossesContours, highestContourAround, isClosedLine, keptClosed} from '../src/layers/relief/contour-rules.js';
import {reliefBehaviors} from '../src/layers/relief/layer-relief.js';
import {settlementBehaviors} from '../src/layers/settlements/layer-settlements.js';

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
