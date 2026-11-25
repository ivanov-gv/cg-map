import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyChangeset} from '../tools/apply-changeset.mjs';
import {entityKey} from '../tools/changeset-derivations.mjs';
import {parseSource, serializeSource} from '../tools/changeset-sources.mjs';
import {reapplyCorrections} from '../tools/reapply-corrections.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const contractsDirectory = path.join(repositoryRoot, 'packages/contracts');
const now = '2026-11-25T10:00:00.000Z';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const localId = number => `local:00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

// A disposable copy: these tests must never write the reviewed sources.
function temporaryRoot(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-editable-layers-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const directory of ['data/sources', 'data/artifacts', 'packages/contracts']) {
    fs.cpSync(path.join(repositoryRoot, directory), path.join(root, directory), {recursive: true});
  }
  return root;
}

const sourcePath = (root, filename) => path.join(root, 'data/sources', filename);
const readSource = (root, filename) => parseSource(filename, fs.readFileSync(sourcePath(root, filename), 'utf8'));
const square = ([longitude, latitude], sizeDegrees) => [
  [
    [longitude, latitude],
    [longitude + sizeDegrees, latitude],
    [longitude + sizeDegrees, latitude + sizeDegrees],
    [longitude, latitude + sizeDegrees],
    [longitude, latitude]
  ]
];

// Collects operations against one reviewed snapshot, in the version 2 format the editor exports.
class ChangesetBuilder {
  operations = [];
  #root;

  constructor(root) {
    this.#root = root;
  }

  find(filename, isWanted) {
    const feature = readSource(this.#root, filename).features.find(isWanted);
    assert.ok(feature, `${filename} has the feature this test needs`);
    return feature;
  }

  add(filename, id, properties, geometry, fields = {}) {
    this.operations.push({
      filename,
      operation: 'add',
      reference: {localId: id},
      beforeFingerprint: null,
      before: null,
      after: {type: 'Feature', ...fields, properties, geometry}
    });
  }

  change(filename, before, edit) {
    const after = structuredClone(before);
    edit?.(after);
    const {entityId, entityPart} = before.properties;
    this.operations.push({
      filename,
      operation: edit ? 'modify' : 'delete',
      reference: entityPart === undefined ? {entityId} : {entityId, entityPart},
      beforeFingerprint: sha256(JSON.stringify(before)),
      before,
      after: edit ? after : null
    });
  }

  build() {
    const filenames = [...new Set(this.operations.map(({filename}) => filename))];
    const bases = Object.fromEntries(
      filenames.map(filename => [filename, sha256(fs.readFileSync(sourcePath(this.#root, filename)))])
    );
    const envelope = {version: 2, id: 'all-layers', createdAt: now, author: 'Test', reason: 'Every layer'};
    return {...envelope, bases, operations: this.operations};
  }
}

const apply = (root, changeset) => applyChangeset(changeset, root, {now, contractsDirectory});
const newBuildingId = localId(1);
const newStopId = localId(6);
const buildingCorner = [19.2, 42.4];

function addNewBuilding(builder) {
  builder.add(
    'buildings.geojson',
    newBuildingId,
    {kind: 'building', building: 'yes', 'building:levels': '3'},
    {type: 'Polygon', coordinates: square(buildingCorner, 0.0004)}
  );
  builder.add(
    'building-labels.geojson',
    localId(2),
    {kind: 'building', 'addr:housenumber': '7', buildingEntityId: newBuildingId},
    {type: 'Point', coordinates: [19.2002, 42.4002]}
  );
  builder.add(
    'building-entrances.geojson',
    localId(3),
    {kind: 'entrance', entrance: 'main', ref: '1', buildingEntityId: newBuildingId},
    {type: 'Point', coordinates: [19.2, 42.4002]}
  );
  const placeId = localId(4);
  builder.add(
    'places.geojson',
    placeId,
    {
      id: placeId,
      source: 'Local correction',
      name: 'New cafe',
      category: 'food',
      kind: 'cafe',
      visibilityLevel: 4,
      buildingEntityId: newBuildingId
    },
    {type: 'Point', coordinates: [19.2002, 42.4001]}
  );
}

// Deletes a building with everything that belongs to it, as the editor does.
function removeNumberedBuilding(root, builder) {
  const buildings = readSource(root, 'buildings.geojson').features;
  const places = readSource(root, 'places.geojson').features;
  const label = builder.find('building-labels.geojson', ({properties}) => {
    const {entityId} = buildings[properties.footprintIndex].properties;
    const isReferenced = places.some(place => place.properties.buildingEntityId === entityId);
    return !properties.entrances && !isReferenced;
  });
  const building = buildings[label.properties.footprintIndex];
  builder.change('building-labels.geojson', label);
  builder.change('buildings.geojson', building);
  return building.properties.entityId;
}

function addStopAndRoute(builder) {
  builder.add(
    'transport-stops.geojson',
    newStopId,
    {name: 'New stop', stopId: newStopId, side: 'left', lines: ['99']},
    {type: 'Point', coordinates: [19.21, 42.41]},
    {id: newStopId}
  );
  const existingStop = builder.find('transport-stops.geojson', ({id}) => id === '1');
  builder.change('transport-stops.geojson', existingStop, stop => {
    stop.properties.lines = ['10', '19', '1B', '23', '6', '9', '99'];
  });
  const directions = [{headsign: 'New line', stops: [newStopId, {turn: [19.22, 42.42]}, '1']}];
  builder.add('transit-routes.json', localId(7), {number: '99', network: 'bus', directions}, null);
}

// One changeset, because the final check reads every source: this is one behaviour across all layers.
test('a changeset across every layer passes the final check and keeps the joins between files', testContext => {
  const root = temporaryRoot(testContext);
  const builder = new ChangesetBuilder(root);
  addNewBuilding(builder);
  const removedBuildingId = removeNumberedBuilding(root, builder);
  addStopAndRoute(builder);
  const green = {kind: 'meadow', name: 'New meadow'};
  builder.add('land.geojson', localId(8), green, {type: 'Polygon', coordinates: [square([19.21, 42.4], 0.001)[0].toReversed()]});
  const river = builder.find('water.geojson', ({geometry, properties}) => properties.kind === 'stream' && geometry.type === 'LineString');
  builder.change('water.geojson', river, feature => feature.geometry.coordinates.reverse());
  const lowContour = builder.find('contours.geojson', ({properties}) => properties.elevation === 40);
  builder.change('contours.geojson', lowContour, feature => feature.geometry.coordinates.splice(1, 1));
  builder.add(
    'summits.geojson',
    localId(9),
    {kind: 'summit', natural: 'peak', name: 'New summit', ele: 104},
    {type: 'Point', coordinates: [19.26, 42.45]}
  );
  const namedSummit = builder.find('summits.geojson', ({properties}) => properties.heightCheck === 'ok');
  builder.change('summits.geojson', namedSummit, feature => (feature.properties.ele += 500));
  const slope = builder.find('slopes.geojson', () => true);
  builder.change('slopes.geojson', slope, feature => {
    feature.geometry.coordinates = square([19.22, 42.43], 0.001);
  });
  builder.change('ridges.geojson', builder.find('ridges.geojson', () => true), feature => {
    feature.properties.name = 'Named ridge';
  });
  builder.change('settlements.geojson', builder.find('settlements.geojson', () => true), feature => {
    feature.properties.rank = 'town';
  });
  builder.change('border-edges.geojson', builder.find('border-edges.geojson', () => true), feature => {
    feature.geometry.coordinates[0] = feature.geometry.coordinates[0].map(value => value + 0.00001);
  });
  builder.change('context-countries.geojson', builder.find('context-countries.geojson', () => true), feature => {
    feature.properties['name:en'] = 'Neighbour';
  });
  builder.add('road-nodes.geojson', localId(10), {kind: 'traffic_signals'}, {type: 'Point', coordinates: [19.2, 42.4]});
  builder.change('turn-restrictions.json', builder.find('turn-restrictions.json', () => true), feature => {
    feature.properties.restriction = 'no_u_turn';
  });
  apply(root, builder.build());

  const buildings = readSource(root, 'buildings.geojson').features;
  const buildingIds = buildings.map(({properties}) => properties.entityId);
  const labels = readSource(root, 'building-labels.geojson').features;
  assert.ok(buildingIds.includes(newBuildingId));
  assert.ok(!buildingIds.includes(removedBuildingId));
  // Labels carry their building's way ID as their own identity, so the join can be checked for every one of them.
  for (const {properties} of labels.filter(({id}) => !id.startsWith('local:'))) {
    assert.equal(buildings[properties.footprintIndex].properties.entityId, properties.osm_id);
  }
  const newLabel = labels.find(({id}) => id === localId(2));
  assert.equal(buildings[newLabel.properties.footprintIndex].properties.entityId, newBuildingId);
  assert.equal(newLabel.properties.buildingEntityId, undefined);
  const summit = readSource(root, 'summits.geojson').features.find(
    ({properties}) => properties.entityId === namedSummit.properties.entityId
  );
  assert.equal(summit.properties.heightCheck, 'mismatch');
  const changedSlope = readSource(root, 'slopes.geojson').features.find(
    ({properties}) => properties.entityId === slope.properties.entityId
  );
  assert.ok(changedSlope.properties.areaSquareMetres > 8000 && changedSlope.properties.areaSquareMetres < 10000);
});

test('a renamed road gives its street join to the buildings on that street', testContext => {
  const root = temporaryRoot(testContext);
  const builder = new ChangesetBuilder(root);
  const buildings = readSource(root, 'buildings.geojson').features;
  const joined = buildings.find(({properties}) => properties['addr:streetEntityIds']?.length === 1);
  const roadId = joined.properties['addr:streetEntityId'];
  const road = builder.find('roads.geojson', ({properties}) => properties.entityId === roadId);
  builder.change('roads.geojson', road, feature => (feature.properties.name = 'Renamed street'));
  apply(root, builder.build());
  const after = readSource(root, 'buildings.geojson').features.find(
    ({properties}) => properties.entityId === joined.properties.entityId
  );
  assert.equal(after.properties['addr:streetEntityId'], undefined);
});

test('a road end taken away from its junction gets one of its own, and roads moved together keep theirs', testContext => {
  const root = temporaryRoot(testContext);
  const builder = new ChangesetBuilder(root);
  const roads = readSource(root, 'roads.geojson').features;
  const startNodes = new Set(roads.map(({properties}) => properties.startNode));
  // Two roads that end there, and none that starts there.
  const roadsByEnd = Map.groupBy(roads, ({properties}) => properties.endNode);
  const [leaving, together] = [...roadsByEnd]
    .filter(([node, meeting]) => node !== undefined && meeting.length === 2 && !startNodes.has(node))
    .map(([, meeting]) => meeting);
  const moveEnd = feature => {
    const end = feature.geometry.coordinates.at(-1);
    feature.geometry.coordinates[feature.geometry.coordinates.length - 1] = [end[0] + 0.00001, end[1]];
  };
  builder.change('roads.geojson', leaving[0], moveEnd);
  for (const road of together) builder.change('roads.geojson', road, moveEnd);
  apply(root, builder.build());
  const written = new Map(readSource(root, 'roads.geojson').features.map(road => [entityKey(road.properties), road]));
  const endNodeNow = road => written.get(entityKey(road.properties)).properties.endNode;
  assert.match(endNodeNow(leaving[0]), /^local:/);
  assert.equal(endNodeNow(leaving[1]), leaving[1].properties.endNode);
  assert.deepEqual(together.map(endNodeNow), together.map(({properties}) => properties.endNode));
});

test('entrances move with their building and turn with its walls, and nothing else about them may change', testContext => {
  const root = temporaryRoot(testContext);
  const buildings = readSource(root, 'buildings.geojson').features;
  const label = readSource(root, 'building-labels.geojson').features.find(({properties}) => properties.entrances);
  const building = buildings[label.properties.footprintIndex];
  const offsetDegrees = 0.0001;
  const shifted = ([longitude, latitude]) => [longitude + offsetDegrees, latitude];
  const moveAll = builder => {
    builder.change('buildings.geojson', building, feature => {
      feature.geometry.coordinates = feature.geometry.coordinates.map(ring => ring.map(shifted));
    });
    builder.change('building-labels.geojson', label, feature => {
      feature.geometry.coordinates = shifted(feature.geometry.coordinates);
      for (const entrance of feature.properties.entrances) entrance.coordinates = shifted(entrance.coordinates);
    });
  };
  const tampered = new ChangesetBuilder(root);
  moveAll(tampered);
  tampered.operations[1].after.properties.entrances[0].id = 'node/1';
  assert.throws(() => apply(root, tampered.build()), /entrances can only move with their building/);
  const builder = new ChangesetBuilder(root);
  moveAll(builder);
  apply(root, builder.build());
  const moved = readSource(root, 'building-labels.geojson').features.find(({id}) => id === label.id);
  const [entrance] = moved.properties.entrances;
  assert.deepEqual(entrance.coordinates, shifted(label.properties.entrances[0].coordinates));
  assert.ok(Math.abs(entrance.bearing - label.properties.entrances[0].bearing) < 0.2, 'a moved wall keeps its direction');
});

test('an object changed since the export is refused, and other changes of the file are not', testContext => {
  const root = temporaryRoot(testContext);
  const first = new ChangesetBuilder(root);
  const [summit, otherSummit] = readSource(root, 'summits.geojson').features;
  first.change('summits.geojson', summit, feature => (feature.properties.name = 'First'));
  const stale = new ChangesetBuilder(root);
  stale.change('summits.geojson', summit, feature => (feature.properties.name = 'Second'));
  const staleChangeset = stale.build();
  const other = new ChangesetBuilder(root);
  other.change('summits.geojson', otherSummit, feature => (feature.properties.name = 'Other'));
  const otherChangeset = other.build();
  apply(root, first.build());
  assert.throws(() => apply(root, staleChangeset), /differs from the reviewed fingerprint/);
  apply(root, otherChangeset);
  const names = readSource(root, 'summits.geojson').features.slice(0, 2).map(({properties}) => properties.name);
  assert.deepEqual(names, ['First', 'Other']);
});

test('a refused correction stops no other: a refreshed address and a way that is gone are reported', testContext => {
  const root = temporaryRoot(testContext);
  const ledgerPath = sourcePath(root, 'editor-corrections.json');
  const applyAs = (id, fill) => {
    const builder = new ChangesetBuilder(root);
    fill(builder);
    apply(root, {...builder.build(), id});
  };
  const labels = readSource(root, 'building-labels.geojson').features;
  const buildings = readSource(root, 'buildings.geojson').features;
  const addressed = new Set(labels.map(({properties}) => properties.footprintIndex));
  const unnumbered = buildings.findIndex(({geometry}, index) => !addressed.has(index) && geometry.coordinates[0].length === 5);
  const building = buildings[unnumbered];
  const [first, , third] = building.geometry.coordinates[0];
  const middle = [0, 1].map(axis => Number(((first[axis] + third[axis]) / 2).toFixed(6)));
  const label = {kind: 'building', 'addr:housenumber': '7', buildingEntityId: building.properties.entityId};
  applyAs('numbered', builder => builder.add('building-labels.geojson', localId(2), label, {type: 'Point', coordinates: middle}));
  const [rule] = readSource(root, 'turn-restrictions.json').features;
  const {from, to, viaNodes} = rule.properties;
  const [town] = readSource(root, 'settlements.geojson').features;
  // One session of unrelated work.
  applyAs('session', builder => {
    builder.add('turn-restrictions.json', localId(8), {restriction: 'no_straight_on', from, to, viaNodes}, null);
    builder.change('settlements.geojson', town, feature => (feature.properties.name = 'Reviewed'));
  });
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  // The refresh gave the building an address of its own, and the way of the turn rule is gone.
  const refreshedLabel = readSource(root, 'building-labels.geojson').features.find(({id}) => id === localId(2));
  fs.cpSync(path.join(repositoryRoot, 'data/sources'), path.join(root, 'data/sources'), {recursive: true});
  const upstream = readSource(root, 'building-labels.geojson');
  const upstreamId = building.properties.entityId;
  upstream.features.push({
    ...refreshedLabel,
    id: upstreamId,
    properties: {...refreshedLabel.properties, 'addr:housenumber': '5', entityId: upstreamId, osm_id: upstreamId, address_sources: [upstreamId]}
  });
  fs.writeFileSync(sourcePath(root, 'building-labels.geojson'), serializeSource('building-labels.geojson', upstream));
  ledger.corrections.find(({filename}) => filename === 'turn-restrictions.json').after.properties.from = 1;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));

  const {report} = reapplyCorrections(root, {now, contractsDirectory});

  assert.equal(readSource(root, 'settlements.geojson').features[0].properties.name, 'Reviewed');
  assert.ok(report.some(line => line.includes("kept the editor's address")), report.join('\n'));
  const replayedLabel = readSource(root, 'building-labels.geojson').features.find(({id}) => id === upstreamId);
  assert.equal(replayedLabel.properties['addr:housenumber'], '7', 'no refresh overrides the editor');
  assert.ok(report.some(line => line.startsWith('turn-restrictions.json') && line.includes('not placed')), report.join('\n'));
});

test('roads of one junction are replayed together, and an end that cannot stay at its junction is reported', testContext => {
  const root = temporaryRoot(testContext);
  const roads = readSource(root, 'roads.geojson').features;
  const meetingRoads = Map.groupBy(roads, ({properties}) => properties.endNode);
  const startNodes = new Set(roads.map(({properties}) => properties.startNode));
  const [pair, alone] = [...meetingRoads]
    .filter(([node, meeting]) => node !== undefined && meeting.length === 2 && !startNodes.has(node))
    .map(([, meeting]) => meeting);
  const moveEnd = feature => {
    const end = feature.geometry.coordinates.at(-1);
    feature.geometry.coordinates[feature.geometry.coordinates.length - 1] = [end[0] + 0.00001, end[1]];
  };
  const builder = new ChangesetBuilder(root);
  for (const road of pair) builder.change('roads.geojson', road, moveEnd);
  builder.change('roads.geojson', alone[0], moveEnd);
  const [town] = readSource(root, 'settlements.geojson').features;
  builder.change('settlements.geojson', town, feature => (feature.properties.name = 'Reviewed'));
  apply(root, builder.build());
  const ledger = JSON.parse(fs.readFileSync(sourcePath(root, 'editor-corrections.json'), 'utf8'));
  fs.cpSync(path.join(repositoryRoot, 'data/sources'), path.join(root, 'data/sources'), {recursive: true});
  // A rule whose roads are gone does not fit, so the corrections are placed group by group.
  ledger.corrections.push({
    ...ledger.corrections.find(({filename}) => filename === 'settlements.geojson'),
    filename: 'turn-restrictions.json',
    operation: 'add',
    reference: {localId: localId(77)},
    before: null,
    beforeFingerprint: null,
    after: {type: 'Feature', geometry: null, properties: {restriction: 'no_left_turn', from: 1, to: 2, viaNodes: [3]}}
  });
  fs.writeFileSync(sourcePath(root, 'editor-corrections.json'), JSON.stringify(ledger));
  const {report} = reapplyCorrections(root, {now, contractsDirectory});
  assert.equal(readSource(root, 'settlements.geojson').features[0].properties.name, 'Reviewed');
  const isLeft = line => line.includes('left junction') && line.includes(alone[0].properties.entityId);
  assert.ok(report.some(isLeft), report.join('\n'));
  const written = new Map(readSource(root, 'roads.geojson').features.map(road => [entityKey(road.properties), road]));
  const nodes = pair.map(road => written.get(entityKey(road.properties)));
  const places = nodes.map(({geometry}) => String(geometry.coordinates.at(-1)));
  assert.equal(places[0], places[1], 'the pair is at one place');
});

test('a replay takes what a refresh put on a deleted building with it, and names what it leaves out', testContext => {
  const root = temporaryRoot(testContext);
  const builder = new ChangesetBuilder(root);
  const deletedId = removeNumberedBuilding(root, builder);
  const [renamed] = readSource(root, 'settlements.geojson').features;
  builder.change('settlements.geojson', renamed, feature => (feature.properties.name = 'Reviewed name'));
  const town = readSource(root, 'settlements.geojson').features[1];
  builder.change('settlements.geojson', town, feature => (feature.properties.name = 'Second name'));
  const ledgerPath = sourcePath(root, 'editor-corrections.json');
  apply(root, builder.build());
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  // The rules of a later day refuse this value.
  const refused = ledger.corrections.find(({after}) => after?.properties.name === 'Second name');
  refused.after.properties.name = '';

  fs.cpSync(path.join(repositoryRoot, 'data/sources'), path.join(root, 'data/sources'), {recursive: true});
  // The refresh no longer has the label the editor deleted, and has another one there.
  ledger.corrections = ledger.corrections.filter(({filename}) => filename !== 'building-labels.geojson');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));

  const {report} = reapplyCorrections(root, {now, contractsDirectory});
  const buildings = readSource(root, 'buildings.geojson').features;
  assert.ok(!buildings.some(({properties}) => properties.entityId === deletedId));
  const names = readSource(root, 'settlements.geojson').features.map(({properties}) => properties.name);
  assert.ok(names.includes('Reviewed name'));
  assert.ok(report.some(line => line.includes('its building was deleted in the editor')), report.join('\n'));
  assert.ok(report.some(line => line.includes(`${town.properties.entityId}: left out`)), report.join('\n'));
});

test('corrections are replayed over refreshed sources and conflicts are reported', testContext => {
  const root = temporaryRoot(testContext);
  const builder = new ChangesetBuilder(root);
  addNewBuilding(builder);
  const [renamed, gone] = readSource(root, 'settlements.geojson').features;
  builder.change('settlements.geojson', renamed, feature => (feature.properties.name = 'Reviewed name'));
  builder.change('settlements.geojson', gone, feature => (feature.properties.name = 'Reviewed and gone'));
  const ledgerPath = sourcePath(root, 'editor-corrections.json');
  apply(root, builder.build());
  const ledger = fs.readFileSync(ledgerPath, 'utf8');

  // A refresh: every source is upstream's again, with one object renamed and one removed upstream.
  fs.cpSync(path.join(repositoryRoot, 'data/sources'), path.join(root, 'data/sources'), {recursive: true});
  fs.writeFileSync(ledgerPath, ledger);
  const refreshed = readSource(root, 'settlements.geojson');
  refreshed.features[0].properties.name = 'Upstream name';
  refreshed.features[0].properties.population = 123;
  refreshed.features.splice(1, 1);
  fs.writeFileSync(sourcePath(root, 'settlements.geojson'), serializeSource('settlements.geojson', refreshed));

  const {report} = reapplyCorrections(root, {now, contractsDirectory});
  const settlement = readSource(root, 'settlements.geojson').features.find(
    ({properties}) => properties.entityId === renamed.properties.entityId
  );
  assert.equal(settlement.properties.name, 'Reviewed name');
  assert.equal(settlement.properties.population, 123);
  assert.ok(report.some(line => line.includes("kept the editor's name")), report.join('\n'));
  assert.ok(report.some(line => line.includes('gone from the refreshed sources')), report.join('\n'));
  const buildings = readSource(root, 'buildings.geojson').features;
  const label = readSource(root, 'building-labels.geojson').features.find(({id}) => id === localId(2));
  assert.equal(buildings[label.properties.footprintIndex].properties.entityId, newBuildingId);
  assert.equal(fs.readFileSync(ledgerPath, 'utf8'), ledger);
});

test('canyon rim corrections survive a refresh with their measured heights', testContext => {
  const root = temporaryRoot(testContext);
  const [changed, deleted] = readSource(root, 'canyon-rims.geojson').features;
  const changedHeight = changed.properties.height === 200 ? 201 : 200;
  const addedId = localId(9);
  const builder = new ChangesetBuilder(root);
  builder.change('canyon-rims.geojson', changed, feature => {
    feature.properties.height = changedHeight;
  });
  builder.change('canyon-rims.geojson', deleted);
  builder.add(
    'canyon-rims.geojson',
    addedId,
    {method: 'editor-drawn', river: 'Ribnica', bank: 'right', height: 77},
    {type: 'LineString', coordinates: [[19.4001, 42.5001], [19.4011, 42.5011]]}
  );
  apply(root, builder.build());
  const ledgerPath = sourcePath(root, 'editor-corrections.json');
  const ledger = fs.readFileSync(ledgerPath, 'utf8');

  fs.cpSync(path.join(repositoryRoot, 'data/sources'), path.join(root, 'data/sources'), {recursive: true});
  fs.writeFileSync(ledgerPath, ledger);
  reapplyCorrections(root, {now, contractsDirectory});

  const written = readSource(root, 'canyon-rims.geojson').features;
  const isSameEntity = (feature, original) => entityKey(feature.properties) === entityKey(original.properties);
  assert.equal(written.find(feature => isSameEntity(feature, changed)).properties.height, changedHeight);
  assert.ok(!written.some(feature => isSameEntity(feature, deleted)), 'a deleted rim stays deleted');
  const added = written.find(({properties}) => properties.entityId === addedId);
  assert.equal(added.properties.method, 'editor-drawn');
  assert.equal(added.properties.height, 77);
  assert.equal(added.properties.kind, 'canyon-rim');
  assert.equal(typeof added.properties.lengthMetres, 'number');
});
