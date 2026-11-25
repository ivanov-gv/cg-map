import test from 'node:test';
import assert from 'node:assert/strict';
import {HeadlessEditor, newLocalId} from '../editor-exports.mjs';
import {behaviorOf} from '../../apps/editor/src/layer-behaviors.js';
import {disconnectEdits, junctionEdits, splitEdits} from '../../apps/editor/src/road-edits.js';
import {jointAt} from '../../apps/editor/src/road-graph.js';
import {sidesOfRidge, slidEnd} from '../../apps/editor/src/ridge-ends.js';
import {turnKey, turnsAt} from '../../apps/editor/src/road-junctions.js';

const roundDegrees = value => Number(value.toFixed(6));
const filesOf = operations => [...new Set(operations.map(({filename}) => filename))].toSorted();
const shiftedRings = (rings, offset) => rings.map(ring => ring.map(point => point.map(value => roundDegrees(value + offset))));

test('a moved building takes its address and entrances along and stays importable', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const label = editor.find('building-labels.geojson', ({properties}) => properties.entrances);
  const key = String(label.feature.properties.footprintIndex);
  const building = structuredClone(editor.features('buildings.geojson')[Number(key)]);
  building.geometry.coordinates = shiftedRings(building.geometry.coordinates, 0.00005);
  assert.equal(editor.apply('buildings.geojson', key, building), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['building-entrances.geojson', 'building-labels.geojson', 'buildings.geojson']);
});

test('a deleted building takes its address with it', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const buildings = editor.features('buildings.geojson');
  const usedIds = new Set(
    ['places.geojson', 'building-entrances.geojson'].flatMap(filename =>
      editor.features(filename).map(({properties}) => properties.buildingEntityId)
    )
  );
  const isAlone = ({properties}) => !usedIds.has(buildings[properties.footprintIndex].properties.entityId);
  const label = editor.find('building-labels.geojson', isAlone);
  const key = String(label.feature.properties.footprintIndex);
  assert.equal(editor.remove('buildings.geojson', key), null);
  const operations = await editor.exportAndImport();
  const {entityId} = editor.features('buildings.geojson')[Number(key)].properties;
  assert.ok(!editor.written('buildings.geojson').some(({properties}) => properties.entityId === entityId));
  assert.deepEqual(filesOf(operations), ['building-labels.geojson', 'buildings.geojson']);
});

test('a drawn building with an address, an entrance and a place passes whole', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const buildingId = newLocalId();
  const corners = [
    [19.2, 42.4],
    [19.2004, 42.4],
    [19.2004, 42.4004],
    [19.2, 42.4004],
    [19.2, 42.4]
  ];
  const building = {
    type: 'Feature',
    properties: {kind: 'building', building: 'yes', 'addr:housenumber': '7', 'addr:street': 'Njegoševa'},
    geometry: {type: 'Polygon', coordinates: [corners]}
  };
  assert.equal(editor.apply('buildings.geojson', buildingId, building), null);
  const entrance = {
    type: 'Feature',
    properties: {kind: 'entrance', entrance: 'main', ref: '1', buildingEntityId: buildingId},
    geometry: {type: 'Point', coordinates: [19.2, 42.4002]}
  };
  assert.equal(editor.apply('building-entrances.geojson', newLocalId(), entrance), null);
  const placeId = newLocalId();
  const place = {
    type: 'Feature',
    properties: {
      id: placeId,
      source: editor.context.rules.localPlaceSource,
      name: 'New cafe',
      category: 'food',
      kind: 'cafe',
      visibilityLevel: 4,
      buildingEntityId: buildingId
    },
    geometry: {type: 'Point', coordinates: [19.2002, 42.4002]}
  };
  assert.equal(editor.apply('places.geojson', placeId, place), null);
  await editor.exportAndImport();
  const isNewAddress = ({properties}) =>
    properties['addr:housenumber'] === '7' && properties['addr:street'] === 'Njegoševa';
  const label = editor.written('building-labels.geojson').find(isNewAddress);
  assert.ok(label);
  const written = editor.written('buildings.geojson')[label.properties.footprintIndex];
  assert.equal(written.properties.entityId, buildingId);
});

test('an address with another number and street passes with its building, and a deleted one too', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const isPlain = ({properties}) => properties['addr:housenumber'] && !properties.entrances && !properties.building_number;
  const changed = editor.find('building-labels.geojson', isPlain);
  const after = structuredClone(changed.feature);
  after.properties['addr:housenumber'] = '123';
  assert.equal(editor.apply(changed.filename, changed.key, after), null);
  const deleted = editor.find('building-labels.geojson', (feature, key) => isPlain(feature) && key !== changed.key);
  assert.equal(editor.remove(deleted.filename, deleted.key), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['building-labels.geojson', 'buildings.geojson']);
  const {footprintIndex} = changed.feature.properties;
  assert.equal(editor.written('buildings.geojson')[footprintIndex].properties['addr:housenumber'], '123');
});

test('a place moved into a building belongs to it after the import', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const building = editor.find('buildings.geojson', ({geometry}) => geometry.coordinates[0].length === 5);
  const [ring] = building.feature.geometry.coordinates;
  const middle = [0, 1].map(axis => roundDegrees((ring[0][axis] + ring[2][axis]) / 2));
  const place = editor.find('places.geojson', ({properties}) => properties.buildingEntityId === undefined);
  const moved = {...place.feature, geometry: {type: 'Point', coordinates: middle}};
  assert.equal(editor.apply(place.filename, place.key, moved), null);
  await editor.exportAndImport();
  const written = editor.written('places.geojson').find(({properties}) => properties.id === place.feature.properties.id);
  assert.equal(written.properties.buildingEntityId, building.feature.properties.entityId);
});

test('a split road, forbidden turns at two junctions and a traffic light pass in one export', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const ruledWays = new Set(editor.features('turn-restrictions.json').flatMap(({properties}) => [properties.from, properties.to]));
  const isPlain = ({properties, geometry}) =>
    properties.kind === 'residential' &&
    properties.oneway === undefined &&
    properties.junction === undefined &&
    geometry.coordinates.length > 3 &&
    !ruledWays.has(Number(properties.entityId.slice('way/'.length)));
  const roads = () => editor.context.entriesOf('roads.geojson');
  // A street that another one passes or ends on: both are split there, and the new halves get a rule between them.
  const passed = editor.session
    .workingEntries('roads.geojson')
    .filter(({feature}) => isPlain(feature))
    .map(({feature}) => jointAt(feature.geometry.coordinates[0], roads()))
    .find(joint => joint.members.length === 2 && joint.members.every(({entry}) => isPlain(entry.feature)) && joint.members.some(({end}) => !end));
  editor.record(splitEdits(passed, editor.context).edits);
  const splitJoint = jointAt(passed.coordinate, roads());
  assert.ok(splitJoint.members.every(({end}) => end));
  const isOntoNewHalf = ({to}) => to.member.entry.key.startsWith('local:');
  const group = turnsAt(splitJoint).find(({turns}) => turns.some(turn => isOntoNewHalf(turn) && turn.kind !== 'uTurn'));
  const turn = group.turns.find(candidate => isOntoNewHalf(candidate) && candidate.kind !== 'uTurn');
  const choices = {[turnKey(group.from, turn.to)]: false, furniture: 'traffic_signals'};
  editor.record(junctionEdits(splitJoint, splitJoint.coordinate, choices, editor.context));
  const operations = await editor.exportAndImport();
  assert.ok(filesOf(operations).includes('turn-restrictions.json'));
  const rule = editor.written('turn-restrictions.json').find(({properties}) => properties.to === turn.to.member.entry.key);
  assert.ok(rule, 'the rule names the half that came from the editor');
  const half = editor.written('roads.geojson').find(({properties}) => properties.entityId === rule.properties.to);
  assert.ok([half.properties.startNode, half.properties.endNode].includes(rule.properties.viaNodes[0]));
  assert.ok(editor.written('road-nodes.geojson').some(({geometry}) => String(geometry.coordinates) === String(passed.coordinate)));
});

test('a junction is moved, a road disconnected from it and joined to it again, and the importer agrees', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const roads = () => editor.context.entriesOf('roads.geojson');
  const isJunction = joint => joint.members.length === 3 && joint.members.every(({end, entry}) => end && entry.feature.geometry.coordinates.length > 2);
  const joint = editor.session
    .workingEntries('roads.geojson')
    .map(({feature}) => jointAt(feature.geometry.coordinates[0], roads()))
    .find(isJunction);
  const moved = [joint.coordinate[0] + 0.00001, joint.coordinate[1]].map(value => Math.round(value * 1e7) / 1e7);
  editor.record(junctionEdits(joint, moved, {}, editor.context));
  const movedJoint = jointAt(moved, roads());
  assert.equal(movedJoint.members.length, 3, 'every road went along');
  const [first] = movedJoint.members;
  editor.record(disconnectEdits(movedJoint, first, editor.context).edits);
  assert.equal(jointAt(moved, roads()).members.length, 2);
  await editor.exportAndImport();
  const written = editor.written('roads.geojson').find(({properties}) => properties.entityId === first.entry.feature.properties.entityId && properties.entityPart === first.entry.feature.properties.entityPart);
  assert.match(String(written.properties[first.end === 'start' ? 'startNode' : 'endNode']), /^local:/);
});

test('a road whose end was dragged takes the roads joined to it along', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const roads = () => editor.context.entriesOf('roads.geojson');
  const entry = editor.find('roads.geojson', feature => {
    const joint = jointAt(feature.geometry.coordinates.at(-1), roads());
    return joint.members.length === 2 && joint.status === 'joined' && feature.properties.kind === 'residential';
  });
  const {coordinates} = entry.feature.geometry;
  const end = coordinates.at(-1);
  const moved = [end[0] + 0.00001, end[1]].map(value => Math.round(value * 1e7) / 1e7);
  const after = {...entry.feature, geometry: {...entry.feature.geometry, coordinates: [...coordinates.slice(0, -1), moved]}};
  assert.equal(editor.apply('roads.geojson', entry.key, after), null);
  const operations = await editor.exportAndImport();
  assert.equal(operations.filter(({filename}) => filename === 'roads.geojson').length, 2);
});

test('a deleted road takes its turn rules out of the sources', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const {from} = editor.features('turn-restrictions.json')[0].properties;
  const road = editor.find('roads.geojson', ({properties}) => properties.entityId === `way/${from}`);
  assert.equal(editor.remove('roads.geojson', road.key), null);
  await editor.exportAndImport();
  const rules = editor.written('turn-restrictions.json');
  assert.ok(!rules.some(({properties}) => properties.from === from || properties.to === from));
});

const square = ([longitude, latitude], size) => [
  [longitude, latitude],
  [longitude + size, latitude],
  [longitude + size, latitude + size],
  [longitude, latitude + size],
  [longitude, latitude]
].map(point => point.map(roundDegrees));

test('a new area with a hole and a new protected area pass', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const meadow = {
    type: 'Feature',
    properties: {kind: 'grass', name: 'New meadow'},
    geometry: {type: 'Polygon', coordinates: [square([19.2, 42.4], 0.004), square([19.201, 42.401], 0.001).toReversed()]}
  };
  assert.equal(editor.apply('land.geojson', newLocalId(), meadow), null);
  const reserve = {
    type: 'Feature',
    properties: {kind: 'protected-area', osmTag: 'leisure=nature_reserve', name: 'New reserve'},
    geometry: {type: 'Polygon', coordinates: [square([19.21, 42.41], 0.004)]}
  };
  assert.equal(editor.apply('protected-areas.geojson', newLocalId(), reserve), null);
  await editor.exportAndImport();
  assert.ok(editor.written('land.geojson').some(({geometry, properties}) => properties.name === 'New meadow' && geometry.coordinates.length === 2));
  assert.ok(editor.written('protected-areas.geojson').some(({properties}) => properties.name === 'New reserve'));
});

// A couple of metres: the real coast has details of ten, which a longer move of one point would cross.
const movedMiddle = ({geometry}) => {
  const middle = geometry.coordinates.length >> 1;
  const coordinates = geometry.coordinates.map((point, index) =>
    index === middle ? point.map(value => roundDegrees(value + 0.00002)) : point
  );
  return {...geometry, coordinates};
};

const isLongLine = ({geometry}) => geometry.coordinates.length > 10;
const isCoastline = ({properties, geometry}) => properties.kind === 'coastline' && geometry.coordinates.length > 4;

test('wherever a coastline is moved, the sea, the country, the border and a municipality follow or it is refused', testContext => {
  const editor = new HeadlessEditor(testContext);
  const coastlines = editor.session.workingEntries('water.geojson').filter(({feature}) => isCoastline(feature));
  // Every tenth of them: each takes a moment.
  const sample = coastlines.filter((_entry, index) => index % 10 === 0);
  const {problem, companionEdits} = behaviorOf('water.geojson');
  let followedCount = 0;
  for (const {filename, key, feature} of sample) {
    const edit = {filename, key, before: feature, feature: {...feature, geometry: movedMiddle(feature)}, extras: {}};
    if (problem(edit, editor.context)) continue;
    followedCount += 1;
    const companions = companionEdits(edit, editor.context);
    const files = filesOf(companions);
    const isSeaMoved = companions.some(({after}) => after.properties.kind === 'ocean');
    assert.ok(isSeaMoved, `the sea follows coastline ${key}`);
    for (const follower of ['border-edges.geojson', 'land.geojson', 'municipalities.geojson']) {
      assert.ok(files.includes(follower), `${follower} follows coastline ${key}`);
    }
  }
  assert.ok(followedCount > sample.length * 0.9, `${followedCount} of ${sample.length} coastlines can be moved`);
});

test('the coast point where an inland border meets the sea stays, and the one beside it moves', testContext => {
  const editor = new HeadlessEditor(testContext);
  const isSeaBorder = ({properties}) => [properties.left, properties.right].includes('sea');
  const inlandEnds = editor
    .features('border-edges.geojson')
    .filter(feature => !isSeaBorder(feature))
    .flatMap(({geometry}) => [geometry.coordinates[0], geometry.coordinates.at(-1)]);
  const endNames = new Set(inlandEnds.map(String));
  const coast = editor.find(
    'water.geojson',
    feature => isCoastline(feature) && isLongLine(feature) && endNames.has(String(feature.geometry.coordinates.at(-1)))
  );
  const {coordinates} = coast.feature.geometry;
  const movedAt = movedIndex => ({
    ...coast.feature,
    geometry: {
      ...coast.feature.geometry,
      coordinates: coordinates.map((point, index) =>
        index === movedIndex ? point.map(value => roundDegrees(value + 0.00002)) : point
      )
    }
  });
  const junctionIndex = coordinates.length - 1;
  assert.match(editor.apply(coast.filename, coast.key, movedAt(junctionIndex)), /border meets the sea/);
  assert.equal(editor.apply(coast.filename, coast.key, movedAt(junctionIndex - 1)), null);
});

test('a moved coastline passes the importer with everything that follows it', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const coast = editor.find('water.geojson', isCoastline);
  assert.equal(editor.apply(coast.filename, coast.key, {...coast.feature, geometry: movedMiddle(coast.feature)}), null);
  const operations = await editor.exportAndImport();
  const expected = ['border-edges.geojson', 'land.geojson', 'municipalities.geojson', 'water.geojson'];
  assert.deepEqual(filesOf(operations), expected);
});

test('a river moved at its joint and a reversed one pass', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const isRiver = ({properties, geometry}) => properties.kind === 'river' && geometry.type === 'LineString' && geometry.coordinates.length > 4;
  const river = editor.find('water.geojson', isRiver);
  const reversed = {...river.feature.geometry, coordinates: river.feature.geometry.coordinates.toReversed()};
  assert.equal(editor.apply(river.filename, river.key, {...river.feature, geometry: reversed}), null);
  const other = editor.find('water.geojson', (feature, key) => isRiver(feature) && key !== river.key);
  assert.equal(editor.apply(other.filename, other.key, {...other.feature, geometry: movedMiddle(other.feature)}), null);
  await editor.exportAndImport();
  const written = editor.written('water.geojson').find(({properties}) => properties.entityId === river.feature.properties.entityId);
  assert.ok(written);
});

const movedAtMiddle = entry => ({...entry.feature, geometry: movedMiddle(entry.feature)});

test('a ridge with its slopes, a contour and a new summit pass', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const ridge = editor.find('ridges.geojson', isLongLine);
  assert.equal(editor.apply(ridge.filename, ridge.key, movedAtMiddle(ridge)), null);
  const contour = editor.find('contours.geojson', isLongLine);
  const smoothed = structuredClone(contour.feature);
  smoothed.geometry.coordinates.splice(5, 1);
  assert.equal(editor.apply(contour.filename, contour.key, smoothed), null);
  const summit = {
    type: 'Feature',
    properties: {kind: 'summit', natural: 'peak', name: 'New summit', ele: 2000},
    geometry: {type: 'Point', coordinates: [19.27, 42.5]}
  };
  assert.equal(editor.apply('summits.geojson', newLocalId(), summit), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['contours.geojson', 'ridges.geojson', 'slopes.geojson', 'summits.geojson']);
});

test('a ridge whose end slid along its hill, and a drawn and a reshaped settlement area pass', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const isOpen = ({geometry}) => String(geometry.coordinates[0]) !== String(geometry.coordinates.at(-1));
  const ridge = editor.find('ridges.geojson', feature => {
    if (!isOpen(feature)) return false;
    const slid = withSlidEnd(feature, editor.context);
    return slid && !behaviorOf('ridges.geojson').problem({feature: slid, before: feature, key: '0'}, editor.context);
  });
  assert.equal(editor.apply(ridge.filename, ridge.key, withSlidEnd(ridge.feature, editor.context)), null);
  const areas = new Set(editor.features('settlement-areas.geojson').map(({properties}) => properties.settlementEntityId));
  const town = editor.find('settlements.geojson', ({properties}) => properties.name === 'Zabjelo' && !areas.has(properties.entityId));
  const [longitude, latitude] = town.feature.geometry.coordinates;
  const corners = [[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002], [0, 0]];
  const drawn = {
    type: 'Feature',
    properties: {kind: 'settlement-area', name: 'Zabjelo', settlementEntityId: town.feature.properties.entityId},
    geometry: {type: 'Polygon', coordinates: [corners.map(([east, north]) => [longitude + east, latitude + north].map(roundDegrees))]}
  };
  assert.equal(editor.apply('settlement-areas.geojson', newLocalId(), drawn), null);
  const area = editor.find('settlement-areas.geojson', ({geometry}) => geometry.type === 'Polygon' && geometry.coordinates[0].length > 8);
  const reshaped = structuredClone(area.feature);
  reshaped.geometry.coordinates[0].splice(3, 1);
  assert.equal(editor.apply(area.filename, area.key, reshaped), null);
  const operations = await editor.exportAndImport();
  assert.deepEqual(filesOf(operations), ['ridges.geojson', 'settlement-areas.geojson', 'slopes.geojson']);
});

// The start of a ridge a little along the outline of its hill.
function withSlidEnd(feature, context) {
  const {coordinates} = feature.geometry;
  const sides = sidesOfRidge(coordinates, context.entriesOf('slopes.geojson'), 60);
  const [longitude, latitude] = coordinates[0];
  const place = sides && slidEnd([longitude + 0.0002, latitude + 0.0001], coordinates.at(-1), sides);
  return place ? {...feature, geometry: {...feature.geometry, coordinates: [place, ...coordinates.slice(1)]}} : null;
}

test('a border with both its municipalities, a country border, a town and a neighbour name pass', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const isInner = ({properties}) => [properties.left, properties.right].every(side => side.startsWith('ME-'));
  const isCountry = ({properties}) =>
    properties.left !== 'sea' && properties.right !== 'sea' && [properties.left, properties.right].some(side => !side.startsWith('ME-') && !side.startsWith('derived:'));
  for (const isWanted of [isInner, isCountry]) {
    const border = editor.find('border-edges.geojson', feature => isWanted(feature) && isLongLine(feature));
    assert.equal(editor.apply(border.filename, border.key, movedAtMiddle(border)), null);
  }
  const town = {
    type: 'Feature',
    properties: {kind: 'settlement', source: editor.context.rules.localPlaceSource, name: 'New town', rank: 'village'},
    geometry: {type: 'Point', coordinates: [19.26, 42.44]}
  };
  assert.equal(editor.apply('settlements.geojson', newLocalId(), town), null);
  const [neighbour] = editor.session.workingEntries('context-countries.geojson');
  const renamed = structuredClone(neighbour.feature);
  renamed.properties.name = 'Renamed neighbour';
  assert.equal(editor.apply(neighbour.filename, neighbour.key, renamed), null);
  await editor.exportAndImport();
  const written = editor.written('settlements.geojson').find(({properties}) => properties.name === 'New town');
  assert.match(written.properties.municipality, /^ME-/);
});

const lineNumbersOf = ({properties}) => properties.lines ?? [];

test('a new stop on a road, a line with one stop less and a new line pass with the lines of their stops', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const road = editor.find('roads.geojson', ({properties, geometry}) => properties.kind === 'residential' && isLongLine({geometry}));
  const stopId = newLocalId();
  const stop = {
    type: 'Feature',
    id: stopId,
    properties: {stopId, name: 'New stop'},
    geometry: {type: 'Point', coordinates: road.feature.geometry.coordinates[3]}
  };
  assert.equal(editor.apply('transport-stops.geojson', stopId, stop), null);
  const isLong = ({properties}) => properties.number && properties.directions[0].stops.length > 4;
  const line = editor.find('transit-routes.json', isLong);
  const shortened = structuredClone(line.feature);
  shortened.properties.directions[0].stops.splice(1, 1);
  assert.equal(editor.apply(line.filename, line.key, shortened), null);
  const [firstStop] = line.feature.properties.directions[0].stops;
  const newLine = {
    type: 'Feature',
    properties: {network: 'bus', number: '77', directions: [{headsign: '', stops: [stopId, firstStop]}]},
    geometry: null
  };
  assert.equal(editor.apply('transit-routes.json', newLocalId(), newLine), null);
  await editor.exportAndImport();
  const written = editor.written('transport-stops.geojson');
  for (const id of [stopId, firstStop]) {
    assert.ok(lineNumbersOf(written.find(({properties}) => properties.stopId === id)).includes('77'));
  }
});

test('a deleted stop leaves its lines', async testContext => {
  const editor = new HeadlessEditor(testContext);
  const stops = editor.session.workingEntries('transport-stops.geojson').filter(({feature}) => lineNumbersOf(feature).length > 0);
  const removed = stops.find(({filename, key}) => editor.remove(filename, key) === null);
  assert.ok(removed, 'a served stop can be removed');
  await editor.exportAndImport();
  const routes = JSON.stringify(editor.written('transit-routes.json').map(({properties}) => properties.directions));
  assert.ok(!routes.includes(`"${removed.feature.properties.stopId}"`));
});
