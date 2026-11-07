import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import {buildChangeset, importChangeset, materializedLayer} from '../src/changeset.js';
import {labelJoinProblems} from '../src/cross-file-checks.js';
import {createActiveFileCommands} from '../src/active-file-commands.js';
import {
  clearSetAsideDrafts,
  openSavedDraft,
  readSavedDraftText,
  readSetAsideDrafts,
  removeSavedDraft,
  saveDraft
} from '../src/draft-store.js';
import {EditSession} from '../src/edit-session.js';
import {
  appendLinePoint,
  insertVertex,
  moveVertex,
  removeVertex,
  translateGeometry,
  vertexHandles
} from '../src/geometry-editing.js';
import {lineProblem, pointInsidePolygon, polygonProblem, ringProblem} from '../src/geometry-validation.js';
import {
  featureCapabilities,
  featureProblem,
  layerLockReason,
  operationProblem,
  propertyProblem,
  validateLayerRules
} from '../src/layer-rules.js';

const readContract = name =>
  JSON.parse(fileSystem.readFileSync(new URL(`../../../packages/contracts/${name}`, import.meta.url)));
const rules = readContract('editor-layers.json');
const geometryCases = readContract('fixtures/editor-geometry-cases.json');
const levels = new Set(readContract('place-visibility.json').levels.map(({level}) => level));

const square = [
  [19.25, 42.44],
  [19.251, 42.44],
  [19.251, 42.441],
  [19.25, 42.441],
  [19.25, 42.44]
];
const placeFeature = (name = 'Cafe') => ({
  type: 'Feature',
  properties: {
    id: 'node/1',
    name,
    category: 'food',
    kind: 'cafe',
    source: 'OpenStreetMap',
    visibilityLevel: 3,
    wikidata: 'Q1'
  },
  geometry: {type: 'Point', coordinates: [19.25, 42.44]}
});
const footprintFeature = () => ({
  type: 'Feature',
  properties: {kind: 'building'},
  geometry: {type: 'Polygon', coordinates: [square]}
});
const labelFeature = () => ({
  type: 'Feature',
  properties: {kind: 'building', 'addr:housenumber': '2', footprintIndex: 0},
  geometry: {type: 'Point', coordinates: [19.2505, 42.4405]}
});

function sourcesWith(featuresByFile) {
  const entries = Object.entries(featuresByFile).map(([filename, features]) => [
    filename,
    {
      metadata: {filename, sha256: 'a'.repeat(64), featureCount: features.length},
      collection: {type: 'FeatureCollection', features}
    }
  ]);
  return new Map(entries);
}

const renamed = (feature, name) => ({...feature, properties: {...feature.properties, name}});
const envelope = {id: 'test', createdAt: '2026-11-06T10:00:00.000Z', author: 'Editor', reason: 'Correction'};

for (const {name, ring, isValid} of geometryCases.rings) {
  test(`shared ring case: ${name}`, () => assert.equal(ringProblem(ring) === null, isValid));
}
for (const {name, line, isValid} of geometryCases.lines) {
  test(`shared line case: ${name}`, () => assert.equal(lineProblem(line) === null, isValid));
}

test('rules must cover every source file', () => {
  assert.throws(() => validateLayerRules(rules, ['unknown.geojson']), /do not cover unknown/);
  assert.equal(validateLayerRules(rules, ['places.geojson']), rules);
});

test('invalid details are refused by the rules of their file', () => {
  const rule = rules.layers['places.geojson'];
  assert.equal(featureProblem(placeFeature(), rule, levels), null);
  assert.match(featureProblem(renamed(placeFeature(), '  '), rule, levels), /name must be nonempty/);
  const badLevel = placeFeature();
  badLevel.properties.visibilityLevel = 99;
  assert.match(featureProblem(badLevel, rule, levels), /not a supported level/);
  const unreviewedLandmark = placeFeature();
  unreviewedLandmark.properties.visibilityLevel = 1;
  assert.match(featureProblem(unreviewedLandmark, rule, levels), /reserved for sights landmarks/);
  unreviewedLandmark.properties.category = 'sights';
  assert.equal(featureProblem(unreviewedLandmark, rule, levels), null);
  const badCategory = placeFeature();
  badCategory.properties.category = 'nightlife';
  assert.match(featureProblem(badCategory, rule, levels), /not an allowed value/);
  const missing = placeFeature();
  delete missing.properties.kind;
  assert.match(featureProblem(missing, rule, levels), /kind is required/);
});

test('files and kinds outside the rules stay inspect-only, with a reason', () => {
  assert.match(layerLockReason(rules.layers['transport-stops.geojson']), /transit import/);
  assert.equal(layerLockReason(rules.layers['places.geojson']), null);
  const country = {type: 'Feature', properties: {kind: 'context'}, geometry: {type: 'Polygon', coordinates: [square]}};
  const land = featureCapabilities(country, rules.layers['land.geojson']);
  assert.equal(land.canModify, false);
  assert.match(land.lockReason, /Country shapes/);
  const park = {...country, properties: {kind: 'park'}};
  assert.equal(featureCapabilities(park, rules.layers['land.geojson']).canModify, true);
  const ocean = {type: 'Feature', properties: {kind: 'ocean'}, geometry: {type: 'MultiPolygon', coordinates: []}};
  assert.equal(featureCapabilities(ocean, rules.layers['water.geojson']).canModify, false);
  assert.equal(featureCapabilities(park, rules.layers['land.geojson']).canDelete, false);
});

test('an edit keeps unknown fields, and returning to the source state leaves no change', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature()]}));
  assert.equal(session.recordEdit('places.geojson', '0', placeFeature()), false);
  assert.equal(session.canUndo('places.geojson'), false);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  const [change] = session.changes('places.geojson');
  assert.equal(change.operation, 'modify');
  assert.equal(change.after.properties.wikidata, 'Q1');
  session.recordEdit('places.geojson', '0', placeFeature());
  assert.deepEqual(session.changedFiles(), []);
});

test('undo and redo are per file, so one mode cannot change another file', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature()], 'roads.geojson': []}));
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  assert.equal(session.undo('roads.geojson'), null);
  assert.equal(session.changes('places.geojson').length, 1);
  assert.equal(session.undo('places.geojson'), '0');
  assert.equal(session.changes('places.geojson').length, 0);
  assert.equal(session.redo('places.geojson'), '0');
  assert.equal(session.workingEntries('places.geojson')[0].feature.properties.name, 'Renamed');
});

test('a new edit clears redo', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature()]}));
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'First'));
  session.undo('places.geojson');
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Second'));
  assert.equal(session.canRedo('places.geojson'), false);
});

test('a deletion removes the feature from the working view and undo restores it', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature(), placeFeature('Other')]}));
  session.recordEdit('places.geojson', '0', null);
  const entries = session.workingEntries('places.geojson');
  assert.deepEqual(
    entries.map(({key}) => key),
    ['1']
  );
  assert.equal(session.changes('places.geojson')[0].operation, 'delete');
  session.undo('places.geojson');
  assert.equal(session.workingEntries('places.geojson').length, 2);
});

test('an added feature comes last, and deleting it leaves no trace', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature()]}));
  const added = renamed(placeFeature(), 'New');
  session.recordEdit('places.geojson', 'local:1', added);
  assert.deepEqual(
    session.workingEntries('places.geojson').map(({key}) => key),
    ['0', 'local:1']
  );
  assert.deepEqual(session.changes('places.geojson')[0].reference, {localId: 'local:1'});
  session.recordEdit('places.geojson', 'local:1', null);
  assert.deepEqual(session.changedFiles(), []);
  session.undo('places.geojson');
  assert.equal(session.workingEntries('places.geojson').at(-1).feature.properties.name, 'New');
});

test('a ring stays closed through every vertex edit', () => {
  const polygon = {type: 'Polygon', coordinates: [square]};
  assert.equal(vertexHandles(polygon).length, 4);
  const firstCorner = {ringIndex: 0, vertexIndex: 0};
  const moved = moveVertex(polygon, firstCorner, [19.2495, 42.4395]);
  assert.deepEqual(moved.coordinates[0][0], [19.2495, 42.4395]);
  assert.deepEqual(moved.coordinates[0].at(-1), [19.2495, 42.4395]);
  assert.equal(ringProblem(moved.coordinates[0]), null);
  const inserted = insertVertex(polygon, {ringIndex: 0, vertexIndex: 3});
  assert.deepEqual(inserted.coordinates[0].at(-2), [19.25, 42.4405]);
  assert.equal(ringProblem(inserted.coordinates[0]), null);
  const removed = removeVertex(polygon, firstCorner);
  assert.equal(ringProblem(removed.coordinates[0]), null);
  assert.equal(removed.coordinates[0].length, 4);
  const tooFew = removeVertex(removed, firstCorner);
  assert.match(ringProblem(tooFew.coordinates[0]), /three corners/);
  assert.deepEqual(polygon.coordinates[0], square, 'edits return new geometry');
});

test('line vertices insert before the end and points append', () => {
  const line = {
    type: 'LineString',
    coordinates: [
      [19, 42],
      [19.2, 42.2]
    ]
  };
  assert.deepEqual(insertVertex(line, {vertexIndex: 0}).coordinates[1], [19.1, 42.1]);
  assert.deepEqual(insertVertex(line, {vertexIndex: 1}).coordinates[1], [19.1, 42.1]);
  assert.equal(appendLinePoint(line, [19.3, 42.3]).coordinates.length, 3);
  assert.match(lineProblem(removeVertex(line, {vertexIndex: 0}).coordinates), /at least two/);
});

test('a whole-footprint move keeps the shape and the closed ring', () => {
  const moved = translateGeometry({type: 'Polygon', coordinates: [square]}, 0.001, 0);
  assert.deepEqual(moved.coordinates[0][0], [19.251, 42.44]);
  assert.equal(ringProblem(moved.coordinates[0]), null);
});

test('a changeset carries base hashes, fingerprints and both states, and imports on the same snapshot', async () => {
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  const session = new EditSession(sources);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  const changeset = await buildChangeset(session, sources, envelope);
  assert.deepEqual(changeset.bases, {'places.geojson': 'a'.repeat(64)});
  assert.match(changeset.operations[0].beforeFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(changeset.operations[0].before.properties.name, 'Cafe');
  const resumed = new EditSession(sources);
  await importChangeset(changeset, resumed, sources, rules, levels);
  assert.equal(resumed.workingEntries('places.geojson')[0].feature.properties.name, 'Renamed');
  assert.deepEqual(materializedLayer(resumed, 'places.geojson').features[0].properties.name, 'Renamed');
});

test('an import is refused whole when the snapshot, fingerprint or rules disagree', async () => {
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  const session = new EditSession(sources);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  const changeset = await buildChangeset(session, sources, envelope);
  const fresh = () => new EditSession(sources);
  const refuses = async (tampered, pattern) => {
    const target = fresh();
    await assert.rejects(importChangeset(tampered, target, sources, rules, levels), pattern);
    assert.deepEqual(target.changedFiles(), []);
  };
  await refuses({...changeset, bases: {'places.geojson': 'b'.repeat(64)}}, /differs from this snapshot/);
  await refuses({...changeset, version: 2}, /unsupported changeset version/);
  const mismatched = structuredClone(changeset);
  mismatched.operations[0].beforeFingerprint = 'c'.repeat(64);
  await refuses(mismatched, /has changed/);
  const invalid = structuredClone(changeset);
  invalid.operations[0].after.properties.name = ' ';
  await refuses(invalid, /nonempty/);
  await assert.rejects(importChangeset(changeset, session, sources, rules, levels), /export or discard/);
});

function memoryStorage() {
  const stored = new Map();
  return {
    stored,
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key)
  };
}

test('a draft survives a reload with its history', () => {
  const storage = memoryStorage();
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  const session = new EditSession(sources);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  saveDraft(storage, session.exportDraft());
  const resumed = new EditSession(sources);
  resumed.restoreDraft(openSavedDraft(storage, sources));
  assert.equal(resumed.workingEntries('places.geojson')[0].feature.properties.name, 'Renamed');
  assert.equal(resumed.undo('places.geojson'), '0');
  saveDraft(storage, resumed.exportDraft());
  assert.equal(new EditSession(sources).canRedo('places.geojson'), false);
  const again = new EditSession(sources);
  again.restoreDraft(openSavedDraft(storage, sources));
  assert.equal(again.canRedo('places.geojson'), true, 'undo history alone is still worth keeping');
});

test('a draft on another snapshot is set aside, and later saves cannot overwrite it', () => {
  const storage = memoryStorage();
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  const session = new EditSession(sources);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Old work'));
  saveDraft(storage, session.exportDraft());
  const changedSnapshot = sourcesWith({'places.geojson': [placeFeature()]});
  changedSnapshot.get('places.geojson').metadata.sha256 = 'f'.repeat(64);

  assert.equal(openSavedDraft(storage, changedSnapshot), null);
  const fresh = new EditSession(changedSnapshot);
  fresh.recordEdit('places.geojson', '0', renamed(placeFeature(), 'New work'));
  saveDraft(storage, fresh.exportDraft());
  fresh.discardAll();
  saveDraft(storage, fresh.exportDraft());

  const [setAside] = readSetAsideDrafts(storage);
  assert.match(setAside.reason, /different version of places.geojson/);
  assert.match(setAside.text, /Old work/);
  clearSetAsideDrafts(storage);
  assert.deepEqual(readSetAsideDrafts(storage), []);
});

test('an unreadable draft is set aside with its raw text, instead of being overwritten', () => {
  const storage = memoryStorage();
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  for (const [text, expected] of [
    ['{broken', /not readable/],
    ['{"version":2}', /unsupported format/]
  ]) {
    storage.setItem('kompas-editor-draft-v1', text);
    assert.equal(openSavedDraft(storage, sources), null);
    const setAside = readSetAsideDrafts(storage).at(-1);
    assert.equal(setAside.text, text);
    assert.match(setAside.reason, expected);
  }
  assert.equal(readSetAsideDrafts(storage).length, 2, 'a second one does not replace the first');
});

test('a draft that cannot be set aside stays in place, and set-aside drafts stay readable', () => {
  const storage = memoryStorage();
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  storage.setItem('kompas-editor-draft-v1', '{broken');
  const realSetItem = storage.setItem;
  storage.setItem = () => {
    throw new Error('quota exceeded');
  };
  assert.throws(() => openSavedDraft(storage, sources), /quota exceeded/);
  storage.setItem = realSetItem;
  assert.equal(readSavedDraftText(storage), '{broken');
  assert.deepEqual(readSetAsideDrafts(storage), []);
  removeSavedDraft(storage);
  assert.equal(readSavedDraftText(storage), null);
});

test('commands reach only the active file, and nothing at all without one', () => {
  const session = new EditSession(sourcesWith({'places.geojson': [placeFeature()], 'roads.geojson': []}));
  let activeFile = null;
  const commands = createActiveFileCommands(session, () => activeFile);
  assert.throws(() => commands.recordEdit('0', placeFeature('New')), /No source file is active/);
  assert.throws(() => commands.undo(), /No source file is active/);
  activeFile = 'places.geojson';
  commands.recordEdit('0', renamed(placeFeature(), 'Renamed'));
  activeFile = 'roads.geojson';
  assert.equal(commands.undo(), null);
  assert.deepEqual(session.changedFiles(), ['places.geojson']);
});

const propertyCases = readContract('fixtures/editor-property-cases.json').cases;
for (const {name, filename, properties, previous, isValid} of propertyCases) {
  test(`shared property case: ${name}`, () => {
    const {properties: propertyRules} = rules.layers[filename];
    assert.equal(propertyProblem(properties, propertyRules, levels, previous) === null, isValid);
  });
}
for (const {name, rings, isValid} of geometryCases.polygons) {
  test(`shared polygon case: ${name}`, () => assert.equal(polygonProblem(rings) === null, isValid));
}

test('source geometry left as it was is not judged again, so a flawed footprint can still be repaired', () => {
  const repeatedCorner = [square[0], square[1], square[1], square[2], square[3], square[0]];
  const flawed = {...footprintFeature(), geometry: {type: 'Polygon', coordinates: [repeatedCorner]}};
  const rule = rules.layers['buildings.geojson'];
  assert.equal(featureProblem(flawed, rule, levels, flawed), null);
  assert.match(featureProblem(flawed, rule, levels, footprintFeature()), /repeats a corner/);
  assert.equal(featureProblem(footprintFeature(), rule, levels, flawed), null);
});

test('an operation that breaks identity or the rules is refused like the importer refuses it', () => {
  const modify = after => ({
    filename: 'places.geojson',
    operation: 'modify',
    reference: {featureIndex: 0},
    before: placeFeature(),
    after
  });
  const withProperties = properties => ({...placeFeature(), properties: {...placeFeature().properties, ...properties}});
  assert.equal(operationProblem(modify(renamed(placeFeature(), 'Fine')), rules, levels), null);
  assert.match(operationProblem(modify(withProperties({invented: 'x'})), rules, levels), /invented is not editable/);
  assert.match(operationProblem(modify(withProperties({id: 'way/9'})), rules, levels), /id is not editable/);
  assert.match(operationProblem(modify({...placeFeature(), id: 'way/9'}), rules, levels), /feature id is not editable/);
  assert.match(operationProblem(modify({...placeFeature(), foo: 1}), rules, levels), /feature foo is not editable/);
  const deletion = {...modify(placeFeature()), operation: 'delete'};
  assert.match(operationProblem(deletion, rules, levels), /a deletion has no after state/);
  const country = {type: 'Feature', properties: {kind: 'context'}, geometry: {type: 'Polygon', coordinates: [square]}};
  const inspectOnly = {
    filename: 'land.geojson',
    operation: 'modify',
    reference: {featureIndex: 0},
    before: country,
    after: {...country, properties: {kind: 'context', name: 'Renamed'}}
  };
  assert.match(operationProblem(inspectOnly, rules, levels), /inspect-only/);
  const added = {
    filename: 'places.geojson',
    operation: 'add',
    reference: {localId: 'way/9'},
    before: null,
    after: placeFeature()
  };
  assert.match(operationProblem(added, rules, levels), /needs a local ID/);
  const fabricated = {...added, reference: {localId: 'local:1'}};
  assert.match(operationProblem(fabricated, rules, levels), /must not claim wikidata/);
});

test('import refuses duplicate references', async () => {
  const sources = sourcesWith({'places.geojson': [placeFeature()]});
  const session = new EditSession(sources);
  session.recordEdit('places.geojson', '0', renamed(placeFeature(), 'Renamed'));
  const changeset = await buildChangeset(session, sources, envelope);
  changeset.operations.push(structuredClone(changeset.operations[0]));
  await assert.rejects(
    importChangeset(changeset, new EditSession(sources), sources, rules, levels),
    /two operations target the same feature/
  );
});

test('removing every corner of a ring is reported, not thrown', () => {
  let polygon = {type: 'Polygon', coordinates: [square]};
  const firstCorner = {ringIndex: 0, vertexIndex: 0};
  for (let removed = 0; removed < 4; removed += 1) polygon = removeVertex(polygon, firstCorner);
  assert.deepEqual(polygon.coordinates[0], []);
  assert.match(ringProblem(polygon.coordinates[0]), /three corners/);
});

test('a footprint or label edit that breaks their join is reported, without rewriting either file', () => {
  const sources = sourcesWith({'buildings.geojson': [footprintFeature()], 'building-labels.geojson': [labelFeature()]});
  const session = new EditSession(sources);
  assert.deepEqual(labelJoinProblems(session), []);
  const moved = {...footprintFeature(), geometry: translateGeometry(footprintFeature().geometry, 0.01, 0)};
  session.recordEdit('buildings.geojson', '0', moved);
  const [problem] = labelJoinProblems(session);
  assert.equal(problem.filename, 'building-labels.geojson');
  assert.match(problem.message, /outside footprint 0/);
  assert.deepEqual(session.changedFiles(), ['buildings.geojson']);
  const followingLabel = {...labelFeature(), geometry: translateGeometry(labelFeature().geometry, 0.01, 0)};
  session.recordEdit('building-labels.geojson', '0', followingLabel);
  assert.deepEqual(labelJoinProblems(session), []);
});

test('a label inside a hole is outside its footprint', () => {
  const hole = [
    [19.2502, 42.4402],
    [19.2508, 42.4402],
    [19.2508, 42.4408],
    [19.2502, 42.4408],
    [19.2502, 42.4402]
  ];
  assert.equal(pointInsidePolygon([19.2505, 42.4405], [square]), true);
  assert.equal(pointInsidePolygon([19.2505, 42.4405], [square, hole]), false);
  assert.equal(pointInsidePolygon([19.3, 42.4405], [square]), false);
});
