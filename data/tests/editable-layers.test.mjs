import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyChangeset} from '../tools/apply-changeset.mjs';
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
