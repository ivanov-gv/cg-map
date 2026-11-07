import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildChangeset, importChangeset, materializedLayer} from '../../apps/editor/src/changeset.js';
import {labelJoinProblems} from '../../apps/editor/src/cross-file-checks.js';
import {EditSession} from '../../apps/editor/src/edit-session.js';
import {translateGeometry} from '../../apps/editor/src/geometry-editing.js';
import {featureProblem} from '../../apps/editor/src/layer-rules.js';
import {applyChangeset} from '../../data/tools/apply-changeset.mjs';

// The contract between the editor and the importer, end to end: whatever the editor exports, the data-owned
// importer must accept, and the result must equal what the editor showed, plus the importer's local origin.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const envelope = {
  id: 'integration-changeset',
  createdAt: '2026-11-06T10:00:00.000Z',
  author: 'Integration Test',
  reason: 'Editor and importer agree'
};
const readContract = filename => JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'packages/contracts', filename)));
const rules = readContract('editor-layers.json');
const levels = new Set(readContract('place-visibility.json').levels.map(({level}) => level));

// A disposable copy: these tests must never write the reviewed sources.
function temporaryRoot(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-editor-changeset-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const directory of ['data/sources', 'data/artifacts', 'packages/contracts']) {
    fs.cpSync(path.join(repositoryRoot, directory), path.join(root, directory), {recursive: true});
  }
  return root;
}

const sourcePath = (root, filename) => path.join(root, 'data/sources', filename);
const readSource = (root, filename) => JSON.parse(fs.readFileSync(sourcePath(root, filename)));

// What the browser holds after verifying the bundle.
function loadSources(root, filenames) {
  const entries = filenames.map(filename => {
    const bytes = fs.readFileSync(sourcePath(root, filename));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return [filename, {metadata: {filename, sha256}, collection: JSON.parse(bytes)}];
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
  const changeset = JSON.parse(JSON.stringify(await buildChangeset(session, sources, envelope)));
  return {changeset, result: applyChangeset(changeset, root, {now: envelope.createdAt})};
}

// What the editor showed, plus the local origin the importer adds to each changed feature.
function withOriginOnChanges(expected, session, filename) {
  const changedFeatures = new Set(session.changes(filename).map(({after}) => JSON.stringify(after)));
  const features = expected.features.map(feature => {
    if (!changedFeatures.has(JSON.stringify(feature))) return feature;
    return {...feature, properties: {...feature.properties, correction_changeset: envelope.id}};
  });
  return {...expected, features};
}

const indexOfFirst = (features, isWanted) => features.findIndex(isWanted);

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
  const {result} = await exportAndApply(session, sources, root);
  assert.deepEqual(result.files, ['places.geojson']);
  assert.equal(result.needsTileRebuild, false);
  const written = readSource(root, 'places.geojson');
  assert.equal(written.features.length, features.length);
  assert.equal(written.features[0].properties.name, 'Renamed by the editor');
  assert.equal(written.features.at(-1).properties.id, localId);
  assert.deepEqual(written.features, withOriginOnChanges(expected, session, 'places.geojson').features);
  const policy = JSON.parse(fs.readFileSync(sourcePath(root, 'place-visibility-policy.json')));
  assert.ok(
    policy.overrides.some(({id}) => id === promoted.properties.id),
    'a level edit becomes a policy override'
  );
});

test('a road drawn in the editor is accepted, and asks for a tile rebuild', async testContext => {
  const root = temporaryRoot(testContext);
  const sources = loadSources(root, ['roads.geojson']);
  const session = new EditSession(sources);
  recordValidEdit(session, 'roads.geojson', 'local:road', {
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
  const {result} = await exportAndApply(session, sources, root);
  assert.equal(result.needsTileRebuild, true);
  assert.deepEqual(
    readSource(root, 'roads.geojson').features,
    withOriginOnChanges(expected, session, 'roads.geojson').features
  );
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
  const changeset = await buildChangeset(session, sources, envelope);
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
  const originalBytes = fs.readFileSync(sourcePath(root, 'buildings.geojson'));
  await assert.rejects(exportAndApply(session, sources, root), /Building label outside its polygon/);
  assert.deepEqual(fs.readFileSync(sourcePath(root, 'buildings.geojson')), originalBytes);
});
