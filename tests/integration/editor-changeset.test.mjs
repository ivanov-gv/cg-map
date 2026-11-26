import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dataToolURL, stageDataInto, stagedSourcePath} from '../data-root.mjs';
import {contractsDirectory, readContractJSON, stageContractsInto} from '../contracts-root.mjs';
import {buildChangeset, importChangeset, materializedLayer} from '../../apps/editor/src/editing/changeset.js';
import {labelJoinProblems} from '../../apps/editor/src/editing/cross-file-checks.js';
import {EditSession} from '../../apps/editor/src/editing/edit-session.js';
import {translateGeometry} from '../../apps/editor/src/geometry/geometry-editing.js';
import {featureProblem} from '../../apps/editor/src/layers/shared/layer-rules.js';
import {collectionOf} from '../../apps/editor/src/source-data/source-records.js';

const {applyChangeset} = await import(dataToolURL('apply-changeset.mjs'));

// The contract between the editor and the importer, end to end: whatever the editor exports, the data-owned
// importer must accept, and the result must equal what the editor showed.
const envelope = {
  id: 'integration-changeset',
  createdAt: '2026-11-06T10:00:00.000Z',
  author: 'Integration Test',
  reason: 'Editor and importer agree'
};
const rules = readContractJSON('editor-layers.json');
const levels = new Set(readContractJSON('place-visibility.json').levels.map(({level}) => level));

// A disposable copy: these tests must never write the reviewed sources.
function temporaryRoot(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-editor-changeset-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  stageContractsInto(root);
  stageDataInto(root);
  return root;
}

const readSource = (root, filename) => JSON.parse(fs.readFileSync(stagedSourcePath(root, filename)));

// What the browser holds after verifying the bundle.
function loadSources(root, filenames) {
  const entries = filenames.map(filename => {
    const bytes = fs.readFileSync(stagedSourcePath(root, filename));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return [filename, {metadata: {filename, sha256}, collection: collectionOf(filename, JSON.parse(bytes))}];
  });
  return new Map(entries);
}

// Every edit must pass the editor's own rules, as Apply requires in the browser.
function recordValidEdit(session, filename, key, feature) {
  const before = session.baseFeature(filename, key);
  assert.equal(featureProblem(feature, rules.layers[filename], levels, before), null);
  assert.equal(session.recordEdit(filename, key, feature), true);
}

// Exports through a JSON round trip, because that is the only way a changeset leaves the browser.
async function exportAndApply(session, sources, root) {
  const changeset = JSON.parse(JSON.stringify(await buildChangeset(session, sources, envelope, rules)));
  return {changeset, result: applyChangeset(changeset, root, {now: envelope.createdAt, contractsDirectory})};
}

const indexOfFirst = (features, isWanted) => features.findIndex(isWanted);

// The importer assigns identity to additions and writes adopted files in identity order. The editor's working view has
// neither yet, so account for exactly those two differences before comparing the reviewed content.
function expectImportedLayer(written, expected, addedOperation, assignedEntityId) {
  const addedVersion = `sha256:${crypto.createHash('sha256').update(JSON.stringify(addedOperation.after)).digest('hex')}`;
  const withIdentity = expected.features.map(feature => {
    if (JSON.stringify(feature) !== JSON.stringify(addedOperation.after)) return feature;
    return {
      ...feature,
      properties: {...feature.properties, entityId: assignedEntityId, entityVersion: addedVersion}
    };
  });
  const identityOrder = [...withIdentity].sort((first, second) => {
    const firstId = first.properties.entityId ?? '';
    const secondId = second.properties.entityId ?? '';
    if (firstId !== secondId) return firstId < secondId ? -1 : 1;
    return (first.properties.entityPart ?? -1) - (second.properties.entityPart ?? -1);
  });
  assert.deepEqual(written.features, identityOrder);
  return addedVersion;
}

test('POI details, level, position, creation and deletion survive the importer unchanged', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['places.geojson']);
  const session = new EditSession(sources);
  const {features} = sources.get('places.geojson').collection;
  const renamed = structuredClone(features[0]);
  renamed.properties.name = 'Renamed by the editor';
  renamed.geometry.coordinates = [19.2601, 42.4402];
  recordValidEdit(session, 'places.geojson', '0', renamed);
  const promoted = structuredClone(features[1]);
  promoted.properties.visibilityLevel = promoted.properties.visibilityLevel === 2 ? 3 : 2;
  recordValidEdit(session, 'places.geojson', '1', promoted);
  session.recordEdit('places.geojson', '2', null);
  const localId = 'local:11111111-1111-4111-8111-111111111111';
  recordValidEdit(session, 'places.geojson', localId, {
    type: 'Feature',
    properties: {
      id: localId,
      source: rules.localPlaceSource,
      name: 'New place',
      category: 'food',
      kind: 'cafe',
      visibilityLevel: 3
    },
    geometry: {type: 'Point', coordinates: [19.2602, 42.4403]}
  });
  const expected = materializedLayer(session, 'places.geojson');
  const {changeset, result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files, ['places.geojson']);
  assert.equal(result.needsTileRebuild, false);
  const written = readSource(root, 'places.geojson');
  assert.equal(written.features.length, features.length);
  assert.equal(written.features.find(({properties}) => properties.name === 'Renamed by the editor').properties.id, features[0].properties.id);
  const added = written.features.find(({properties}) => properties.id === localId);
  assert.equal(added.properties.entityId, localId, 'an object keeps the ID it had in the editor');
  const addOperation = changeset.operations.find(operation => operation.operation === 'add');
  const addedVersion = expectImportedLayer(written, expected, addOperation, localId);
  assert.equal(added.properties.entityVersion, addedVersion);
  const policy = JSON.parse(fs.readFileSync(stagedSourcePath(root, 'place-visibility-policy.json')));
  assert.ok(
    policy.overrides.some(({id}) => id === promoted.properties.id),
    'a level edit becomes a policy override'
  );
});

test('a road drawn in the editor is accepted, and asks for a tile rebuild', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['roads.geojson']);
  const session = new EditSession(sources);
  const localId = 'local:33333333-3333-4333-8333-333333333333';
  recordValidEdit(session, 'roads.geojson', localId, {
    type: 'Feature',
    properties: {kind: 'footway', name: 'New path'},
    geometry: {
      type: 'LineString',
      coordinates: [
        [19.26, 42.44],
        [19.261, 42.441]
      ]
    }
  });
  const expected = materializedLayer(session, 'roads.geojson');
  const {changeset, result} = await exportAndApply(session, sources, root);
  assert.equal(result.needsTileRebuild, true);
  const addOperation = changeset.operations.find(operation => operation.operation === 'add');
  expectImportedLayer(readSource(root, 'roads.geojson'), expected, addOperation, localId);
});

test('moving an unnamed road keeps its blank source name, and the importer accepts it', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['roads.geojson']);
  const session = new EditSession(sources);
  const {features} = sources.get('roads.geojson').collection;
  const index = features.findIndex(({properties}) => properties.name === '');
  assert.ok(index >= 0, 'the sources contain a road with a blank name');
  const moved = {...features[index], geometry: translateGeometry(features[index].geometry, 0.0001, 0)};
  recordValidEdit(session, 'roads.geojson', String(index), moved);
  await exportAndApply(session, sources, root);
  const written = readSource(root, 'roads.geojson').features[index];
  assert.equal(written.properties.name, '');
  assert.deepEqual(written.geometry, moved.geometry);
});

test('a placeholder address is refused by the editor and by the importer alike', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['building-labels.geojson']);
  const session = new EditSession(sources);
  const label = sources.get('building-labels.geojson').collection.features[0];
  const placeholder = structuredClone(label);
  placeholder.properties['addr:housenumber'] = 'n/a';
  const before = session.baseFeature('building-labels.geojson', '0');
  assert.match(featureProblem(placeholder, rules.layers['building-labels.geojson'], levels, before), /placeholder/);
  session.recordEdit('building-labels.geojson', '0', placeholder);
  await assert.rejects(exportAndApply(session, sources, root), /placeholder/);
});

test('a footprint move with its label corrected in its own mode passes the cross-file check', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['buildings.geojson', 'building-labels.geojson']);
  const session = new EditSession(sources);
  const label = sources.get('building-labels.geojson').collection.features[0];
  const footprintIndex = label.properties.footprintIndex;
  const footprint = sources.get('buildings.geojson').collection.features[footprintIndex];
  const offset = 0.0001;
  const movedFootprint = {...footprint, geometry: translateGeometry(footprint.geometry, offset, 0)};
  recordValidEdit(session, 'buildings.geojson', String(footprintIndex), movedFootprint);
  const movedLabel = {...label, geometry: translateGeometry(label.geometry, offset, 0)};
  recordValidEdit(session, 'building-labels.geojson', '0', movedLabel);
  assert.deepEqual(labelJoinProblems(session), []);
  const {result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files.toSorted(), ['building-labels.geojson', 'buildings.geojson']);
  assert.deepEqual(readSource(root, 'building-labels.geojson').features[0].geometry, movedLabel.geometry);
});

test('parks and rivers are editable through the importer, and the editor can resume its own export', async testContext => {
  const root = temporaryRoot(testContext);
  const filenames = ['land.geojson', 'water.geojson'];
  const sources = loadSources(root, filenames);
  const session = new EditSession(sources);
  const renameFirst = (filename, kind) => {
    const {features} = sources.get(filename).collection;
    const index = indexOfFirst(
      features,
      ({properties, geometry}) => properties.kind === kind && rules.layers[filename].geometries.includes(geometry.type)
    );
    assert.ok(index >= 0, `the sources contain an editable ${kind}`);
    const renamed = structuredClone(features[index]);
    renamed.properties.name = `Renamed ${kind}`;
    recordValidEdit(session, filename, String(index), renamed);
  };
  renameFirst('land.geojson', 'park');
  renameFirst('water.geojson', 'river');
  const changeset = await buildChangeset(session, sources, envelope, rules);
  const resumed = new EditSession(sources);
  await importChangeset(JSON.parse(JSON.stringify(changeset)), resumed, sources, rules, levels);
  assert.deepEqual(resumed.changedFiles().toSorted(), filenames);
  const {result} = await exportAndApply(resumed, sources, root);
  assert.equal(result.needsTileRebuild, true);
});

test('the importer refuses a footprint move that strands its label, as the editor warned', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['buildings.geojson', 'building-labels.geojson']);
  const session = new EditSession(sources);
  const {footprintIndex} = sources.get('building-labels.geojson').collection.features[0].properties;
  const footprint = sources.get('buildings.geojson').collection.features[footprintIndex];
  const moved = {...footprint, geometry: translateGeometry(footprint.geometry, 0.01, 0)};
  recordValidEdit(session, 'buildings.geojson', String(footprintIndex), moved);
  assert.equal(labelJoinProblems(session).length, 1);
  const originalBytes = fs.readFileSync(stagedSourcePath(root, 'buildings.geojson'));
  await assert.rejects(exportAndApply(session, sources, root), /Building label outside its polygon/);
  assert.deepEqual(fs.readFileSync(stagedSourcePath(root, 'buildings.geojson')), originalBytes);
});

// One edit per file the earlier bundles kept read-only, so the editor's rules and the importer's agree on each of them.
test('objects of every other layer pass from the editor through the importer', async testContext => {
  const root = temporaryRoot(testContext);
  const renamedFiles = ['settlements.geojson', 'municipalities.geojson', 'context-countries.geojson', 'summits.geojson'];
  const filenames = [...renamedFiles, 'contours.geojson', 'building-entrances.geojson', 'transit-routes.json'];
  const sources = loadSources(root, filenames);
  const session = new EditSession(sources);
  for (const filename of renamedFiles) {
    const renamed = structuredClone(sources.get(filename).collection.features[0]);
    renamed.properties.name = 'Renamed by the editor';
    recordValidEdit(session, filename, '0', renamed);
  }
  const contour = structuredClone(sources.get('contours.geojson').collection.features[0]);
  contour.geometry.coordinates.splice(1, 1);
  recordValidEdit(session, 'contours.geojson', '0', contour);
  const entrance = structuredClone(sources.get('building-entrances.geojson').collection.features[0]);
  entrance.properties.opens_onto = 'courtyard';
  recordValidEdit(session, 'building-entrances.geojson', '0', entrance);
  const route = structuredClone(sources.get('transit-routes.json').collection.features[0]);
  route.properties.colour = '#1b75bb';
  recordValidEdit(session, 'transit-routes.json', '0', route);
  const {result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files.toSorted(), filenames.toSorted());
  const writtenRoutes = collectionOf('transit-routes.json', readSource(root, 'transit-routes.json'));
  assert.equal(writtenRoutes.features[0].properties.colour, '#1b75bb');
});

test('canyon rims can be added, changed and deleted with one measured height each', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['canyon-rims.geojson']);
  const session = new EditSession(sources);
  const {features} = sources.get('canyon-rims.geojson').collection;

  const changed = structuredClone(features[0]);
  const changedHeight = changed.properties.height === 200 ? 201 : 200;
  changed.properties.height = changedHeight;
  recordValidEdit(session, 'canyon-rims.geojson', '0', changed);
  const deleted = features[1];
  session.recordEdit('canyon-rims.geojson', '1', null);

  const localId = 'local:55555555-5555-4555-8555-555555555555';
  const drawn = {
    type: 'Feature',
    properties: {height: 77},
    geometry: {type: 'LineString', coordinates: [[19.4001, 42.5001], [19.4011, 42.5011]]}
  };
  recordValidEdit(session, 'canyon-rims.geojson', localId, drawn);
  const unmeasuredId = 'local:77777777-7777-4777-8777-777777777777';
  const unmeasured = {
    type: 'Feature',
    properties: {},
    geometry: {type: 'LineString', coordinates: [[19.4101, 42.5101], [19.4111, 42.5111]]}
  };
  recordValidEdit(session, 'canyon-rims.geojson', unmeasuredId, unmeasured);

  const {changeset, result} = await exportAndApply(session, sources, root);
  assert.equal(result.needsTileRebuild, true);
  const written = readSource(root, 'canyon-rims.geojson');
  const identityOf = ({entityId, entityPart}) => `${entityId}#${entityPart ?? ''}`;
  assert.equal(written.features.length, features.length + 1, 'two rims were added and one was deleted');
  assert.equal(
    written.features.find(({properties}) => identityOf(properties) === identityOf(changed.properties)).properties.height,
    changedHeight
  );
  assert.ok(
    !written.features.some(({properties}) => identityOf(properties) === identityOf(deleted.properties)),
    'a deleted rim is absent from the reviewed source'
  );

  const added = written.features.find(({properties}) => properties.entityId === localId);
  assert.equal(added.properties.method, 'editor-drawn');
  assert.equal(added.properties.kind, 'canyon-rim');
  assert.equal(added.properties.height, 77);
  assert.equal('river' in added.properties, false);
  assert.equal('bank' in added.properties, false);
  const unmeasuredWritten = written.features.find(({properties}) => properties.entityId === unmeasuredId);
  assert.equal(unmeasuredWritten.properties.method, 'editor-drawn');
  assert.equal(unmeasuredWritten.properties.height, undefined);
  assert.equal('river' in unmeasuredWritten.properties, false);
  assert.equal('bank' in unmeasuredWritten.properties, false);
  const changedWritten = written.features.find(
    ({properties}) => identityOf(properties) === identityOf(changed.properties)
  );
  assert.equal(changedWritten.properties.method, changed.properties.method);
  assert.equal(changedWritten.properties.river, changed.properties.river);
  assert.equal(changedWritten.properties.bank, changed.properties.bank);
  assert.equal(typeof added.properties.lengthMetres, 'number');
  assert.ok(added.properties.lengthMetres > 100 && added.properties.lengthMetres < 200);
  const addOperation = changeset.operations.find(
    operation => operation.operation === 'add' && operation.reference.localId === localId
  );
  assert.ok(addOperation, 'the added rim is present in the changeset');
  assert.equal(
    added.properties.entityVersion,
    `sha256:${crypto.createHash('sha256').update(JSON.stringify(addOperation.after)).digest('hex')}`
  );
});

test('a rim height edit keeps the original length', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['canyon-rims.geojson']);
  const session = new EditSession(sources);
  const {features} = sources.get('canyon-rims.geojson').collection;
  const index = features.findIndex(({properties}) => Number.isInteger(properties.height));
  assert.notEqual(index, -1, 'the reviewed rims include a measured edge');
  const original = features[index];
  const edited = structuredClone(original);
  edited.properties.height = original.properties.height === 1 ? 2 : 1;
  recordValidEdit(session, 'canyon-rims.geojson', String(index), edited);

  const {result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files, ['canyon-rims.geojson']);
  const written = readSource(root, 'canyon-rims.geojson').features.find(({properties}) =>
    properties.entityId === original.properties.entityId &&
    properties.entityPart === original.properties.entityPart
  );
  assert.equal(written.properties.height, edited.properties.height);
  assert.equal(written.properties.lengthMetres, original.properties.lengthMetres);
});

test('a reshaped rim gets a longer measured length', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['canyon-rims.geojson']);
  const session = new EditSession(sources);
  const {features} = sources.get('canyon-rims.geojson').collection;
  const original = features[0];
  const edited = structuredClone(original);
  const coordinates = edited.geometry.coordinates;
  const end = coordinates.at(-1);
  const previous = coordinates.at(-2);
  const extensionMultiple = 2;
  const extendedEnd = [
    end[0] + (end[0] - previous[0]) * extensionMultiple,
    end[1] + (end[1] - previous[1]) * extensionMultiple
  ];
  coordinates.push(extendedEnd);
  recordValidEdit(session, 'canyon-rims.geojson', '0', edited);

  const {result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files, ['canyon-rims.geojson']);
  const written = readSource(root, 'canyon-rims.geojson').features.find(({properties}) =>
    properties.entityId === original.properties.entityId &&
    properties.entityPart === original.properties.entityPart
  );
  assert.deepEqual(written.geometry.coordinates.at(-1), extendedEnd);
  assert.ok(written.properties.lengthMetres > original.properties.lengthMetres);
});

test('the importer refuses a canyon rim that states a derived fact', async testContext => {
  const claimed = {
    kind: 'canyon-rim',
    method: 'editor-drawn',
    lengthMetres: 120
  };
  for (const [field, value] of Object.entries(claimed)) {
    const root = temporaryRoot(testContext);
    const sources = loadSources(root, ['canyon-rims.geojson']);
    const session = new EditSession(sources);
    const localId = 'local:66666666-6666-4666-8666-666666666666';
    const drawn = {
      type: 'Feature',
      properties: {[field]: value, height: 77},
      geometry: {type: 'LineString', coordinates: [[19.4001, 42.5001], [19.4011, 42.5011]]}
    };
    session.recordEdit('canyon-rims.geojson', localId, drawn);
    const originalBytes = fs.readFileSync(stagedSourcePath(root, 'canyon-rims.geojson'));
    await assert.rejects(
      exportAndApply(session, sources, root),
      new RegExp(`canyon-rims\\.geojson.*a new feature must not claim ${field}`)
    );
    assert.deepEqual(fs.readFileSync(stagedSourcePath(root, 'canyon-rims.geojson')), originalBytes);
  }
});
