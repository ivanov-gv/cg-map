import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyChangeset, lineProblem, polygonProblem, propertyProblem, ringProblem} from '../tools/apply-changeset.mjs';
import {checkData} from '../tools/check-data.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = feature => sha256(JSON.stringify(feature));
const reviewedAt = '2026-11-06T10:00:00.000Z';

// A disposable copy: these tests must never write the reviewed sources.
function temporaryRoot(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-changeset-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const directory of ['data/sources', 'data/artifacts', 'packages/contracts']) {
    fs.cpSync(path.join(repositoryRoot, directory), path.join(root, directory), {recursive: true});
  }
  return root;
}

const sourcePath = (root, filename) => path.join(root, 'data/sources', filename);
const readSource = (root, filename) => JSON.parse(fs.readFileSync(sourcePath(root, filename)));

function changeset(root, filename, operations) {
  return {
    version: 1,
    id: 'test-changeset',
    createdAt: reviewedAt,
    author: 'Test Editor',
    reason: 'Test correction',
    bases: {[filename]: sha256(fs.readFileSync(sourcePath(root, filename)))},
    operations
  };
}

function modifyOperation(root, filename, featureIndex, change) {
  const before = readSource(root, filename).features[featureIndex];
  const after = structuredClone(before);
  change(after);
  return {
    filename,
    operation: 'modify',
    reference: {featureIndex},
    beforeFingerprint: fingerprint(before),
    before,
    after
  };
}

const cases = JSON.parse(
  fs.readFileSync(new URL('packages/contracts/fixtures/editor-geometry-cases.json', `file://${repositoryRoot}`))
);
for (const {name, ring, isValid} of cases.rings) {
  test(`ring validation: ${name}`, () => assert.equal(ringProblem(ring) === null, isValid));
}
for (const {name, line, isValid} of cases.lines) {
  test(`line validation: ${name}`, () => assert.equal(lineProblem(line) === null, isValid));
}

test('a metadata edit updates the source, provenance and ledger, and still passes the data check', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'places.geojson', 0, feature => {
    feature.properties.name = 'Corrected name';
  });
  const summary = applyChangeset(changeset(root, 'places.geojson', [operation]), root, {now: reviewedAt});
  assert.equal(summary.needsTileRebuild, false);
  assert.equal(readSource(root, 'places.geojson').features[0].properties.name, 'Corrected name');
  assert.doesNotThrow(() => checkData(root));
  const {corrections} = JSON.parse(fs.readFileSync(sourcePath(root, 'editor-corrections.json')));
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].beforeFingerprint, operation.beforeFingerprint);
  assert.equal(corrections[0].author, 'Test Editor');
});

test('a corrected feature names its changeset, keeps its attribution, and matches the ledger', testContext => {
  const root = temporaryRoot(testContext);
  const before = readSource(root, 'places.geojson').features[0];
  const operation = modifyOperation(root, 'places.geojson', 0, feature => {
    feature.properties.name = 'Corrected name';
  });
  const reviewed = changeset(root, 'places.geojson', [operation]);
  applyChangeset(reviewed, root, {now: reviewedAt});
  const written = readSource(root, 'places.geojson').features[0];
  assert.equal(written.properties.correction_changeset, reviewed.id);
  assert.equal(written.properties.source, before.properties.source);
  assert.equal(written.properties.id, before.properties.id);
  const [correction] = JSON.parse(fs.readFileSync(sourcePath(root, 'editor-corrections.json'))).corrections;
  assert.equal(correction.after.properties.correction_changeset, reviewed.id);
  assert.equal(correction.afterFingerprint, fingerprint(written), 'the ledger must name the feature as it was written');
  const untouched = readSource(root, 'places.geojson').features[1];
  assert.equal(untouched.properties.correction_changeset, undefined);
});

test('a level-only correction leaves the hash of place facts as it was', testContext => {
  const root = temporaryRoot(testContext);
  const readProvenance = () => JSON.parse(fs.readFileSync(sourcePath(root, 'provenance.json')));
  const factsHashBefore = readProvenance().places_facts_sha256;
  const operation = modifyOperation(root, 'places.geojson', 0, feature => {
    feature.properties.visibilityLevel = feature.properties.visibilityLevel === 2 ? 3 : 2;
  });
  applyChangeset(changeset(root, 'places.geojson', [operation]), root, {now: reviewedAt});
  assert.equal(readProvenance().places_facts_sha256, factsHashBefore);
});

test('the data check refuses a correction whose changeset is not in the ledger', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'roads.geojson', 0, feature => {
    feature.properties.name = 'Corrected road';
  });
  applyChangeset(changeset(root, 'roads.geojson', [operation]), root, {now: reviewedAt});
  assert.doesNotThrow(() => checkData(root));
  fs.rmSync(sourcePath(root, 'editor-corrections.json'));
  assert.throws(() => checkData(root), /roads\.geojson: correction_changeset .* is not in the ledger/);
});

test('a changeset cannot set the local origin itself', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'places.geojson', 0, feature => {
    feature.properties.correction_changeset = 'someone-else';
  });
  assert.throws(() => applyChangeset(changeset(root, 'places.geojson', [operation]), root, {now: reviewedAt}), /refused/);
});

test('a feature corrected twice names the later changeset', testContext => {
  const root = temporaryRoot(testContext);
  const rename = name => feature => {
    feature.properties.name = name;
  };
  const first = changeset(root, 'places.geojson', [modifyOperation(root, 'places.geojson', 0, rename('First'))]);
  applyChangeset(first, root, {now: reviewedAt});
  const second = {
    ...changeset(root, 'places.geojson', [modifyOperation(root, 'places.geojson', 0, rename('Second'))]),
    id: 'later-changeset'
  };
  applyChangeset(second, root, {now: reviewedAt});
  assert.equal(readSource(root, 'places.geojson').features[0].properties.correction_changeset, 'later-changeset');
});

test('a level edit becomes a policy override, and survives regenerating levels', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'places.geojson', 0, feature => {
    feature.properties.visibilityLevel = feature.properties.visibilityLevel === 2 ? 3 : 2;
  });
  applyChangeset(changeset(root, 'places.geojson', [operation]), root, {now: reviewedAt});
  const policy = JSON.parse(fs.readFileSync(sourcePath(root, 'place-visibility-policy.json')));
  const override = policy.overrides.find(({id}) => id === operation.before.properties.id);
  assert.equal(override.level, operation.after.properties.visibilityLevel);
  assert.equal(override.provenance.reviewedBy, 'Test Editor');
  assert.equal(readSource(root, 'places.geojson').features[0].properties.visibilityLevel, override.level);
  assert.doesNotThrow(() => checkData(root));
});

test('a new place keeps its local identity, and a deletion removes the feature', testContext => {
  const root = temporaryRoot(testContext);
  const localId = 'local:11111111-1111-4111-8111-111111111111';
  const after = {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [19.25, 42.44]},
    properties: {
      id: localId,
      name: 'New cafe',
      category: 'food',
      kind: 'cafe',
      source: 'Local correction',
      visibilityLevel: 4
    }
  };
  const before = readSource(root, 'places.geojson').features[0];
  const count = readSource(root, 'places.geojson').features.length;
  const operations = [
    {filename: 'places.geojson', operation: 'add', reference: {localId}, beforeFingerprint: null, before: null, after},
    {
      filename: 'places.geojson',
      operation: 'delete',
      reference: {featureIndex: 0},
      beforeFingerprint: fingerprint(before),
      before,
      after: null
    }
  ];
  applyChangeset(changeset(root, 'places.geojson', operations), root, {now: reviewedAt});
  const {features} = readSource(root, 'places.geojson');
  assert.equal(features.length, count);
  assert.equal(features.at(-1).properties.id, localId);
  assert.ok(features.every(feature => feature.properties.id !== before.properties.id));
  assert.doesNotThrow(() => checkData(root));
});

test('level 1 outside the landmark category is refused by name, before anything is written', testContext => {
  const root = temporaryRoot(testContext);
  const places = readSource(root, 'places.geojson');
  const index = places.features.findIndex(({properties}) => properties.category === 'food');
  const before = places.features[index];
  const after = structuredClone(before);
  after.properties.visibilityLevel = 1;
  const original = fs.readFileSync(sourcePath(root, 'places.geojson'));
  const operation = {
    filename: 'places.geojson',
    operation: 'modify',
    reference: {featureIndex: index},
    beforeFingerprint: sha256(JSON.stringify(before)),
    before,
    after
  };
  const refused = changeset(root, 'places.geojson', [operation]);
  assert.throws(() => applyChangeset(refused, root, {now: reviewedAt}), /reserved for sights landmarks/);
  assert.deepEqual(fs.readFileSync(sourcePath(root, 'places.geojson')), original);
});

const editingRules = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'packages/contracts/editor-layers.json')));
const supportedLevels = new Set(
  JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'packages/contracts/place-visibility.json'))).levels.map(
    ({level}) => level
  )
);
const propertyCases = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'packages/contracts/fixtures/editor-property-cases.json'))
).cases;
for (const {name, filename, properties, previous, isValid} of propertyCases) {
  test(`property validation: ${name}`, () => {
    const {properties: propertyRules} = editingRules.layers[filename];
    assert.equal(propertyProblem(properties, propertyRules, supportedLevels, previous) === null, isValid);
  });
}
for (const {name, rings, isValid} of cases.polygons) {
  test(`polygon validation: ${name}`, () => assert.equal(polygonProblem(rings) === null, isValid));
}

const addOperation = (filename, localId, after) => ({
  filename,
  operation: 'add',
  reference: {localId},
  beforeFingerprint: null,
  before: null,
  after
});
const road = properties => ({
  type: 'Feature',
  properties,
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.26, 42.44],
      [19.261, 42.441]
    ]
  }
});

test('an added feature cannot claim an upstream identity or anything the rules do not list', testContext => {
  const root = temporaryRoot(testContext);
  const refuses = (operation, expected) =>
    assert.throws(
      () => applyChangeset(changeset(root, operation.filename, [operation]), root, {now: reviewedAt}),
      expected
    );
  const place = (id, extra = {}) => ({
    type: 'Feature',
    properties: {
      id,
      source: editingRules.localPlaceSource,
      name: 'New',
      category: 'food',
      kind: 'cafe',
      visibilityLevel: 4,
      ...extra
    },
    geometry: {type: 'Point', coordinates: [19.26, 42.44]}
  });
  refuses(addOperation('places.geojson', 'way/999', place('way/999')), /needs a local ID/);
  refuses(addOperation('places.geojson', 'local:new', place('way/999')), /use its local ID/);
  refuses(addOperation('places.geojson', 'local:new', place('local:new', {osm_id: 'way/1'})), /must not claim osm_id/);
  refuses(addOperation('places.geojson', 'local:new', place('local:new', {invented: 'x'})), /must not claim invented/);
  refuses(
    addOperation('roads.geojson', 'local:road', road({kind: 'footway', invented: 'x'})),
    /must not claim invented/
  );
  refuses(addOperation('roads.geojson', 'local:road', {...road({kind: 'footway'}), id: 'way/1'}), /claim a feature id/);
});

test('a deletion that also carries an after state is refused', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'X'));
  const refused = changeset(root, 'places.geojson', [{...operation, operation: 'delete'}]);
  assert.throws(() => applyChangeset(refused, root, {now: reviewedAt}), /a deletion has no after state/);
});

test('renaming a place keeps its override and its reviewer, and a matching level removes nothing else', testContext => {
  const root = temporaryRoot(testContext);
  const reviewerOf = id =>
    JSON.parse(fs.readFileSync(sourcePath(root, 'place-visibility-policy.json'))).overrides.find(
      override => override.id === id
    )?.provenance.reviewedBy;
  const promoted = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => {
      feature.properties.visibilityLevel = feature.properties.visibilityLevel === 2 ? 3 : 2;
    })
  ]);
  applyChangeset(promoted, root, {now: reviewedAt});
  const {id} = readSource(root, 'places.geojson').features[0].properties;
  assert.equal(reviewerOf(id), 'Test Editor');
  const renamed = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'Renamed'))
  ]);
  renamed.author = 'Second Editor';
  applyChangeset(renamed, root, {now: reviewedAt});
  assert.equal(reviewerOf(id), 'Test Editor');
});

test('changing a kind pins the reviewed level, so regeneration cannot silently change it', testContext => {
  const root = temporaryRoot(testContext);
  const {features} = readSource(root, 'places.geojson');
  const index = features.findIndex(
    ({properties}) => properties.kind !== 'supermarket' && properties.visibilityLevel !== 4
  );
  const {visibilityLevel} = features[index].properties;
  const edited = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', index, feature => (feature.properties.kind = 'supermarket'))
  ]);
  applyChangeset(edited, root, {now: reviewedAt});
  assert.equal(readSource(root, 'places.geojson').features[index].properties.visibilityLevel, visibilityLevel);
});

test('the ledger keeps both values and matches its schema, and a failed final check restores every file', testContext => {
  const root = temporaryRoot(testContext);
  const ledgerFile = sourcePath(root, 'editor-corrections.json');
  const placesBefore = fs.readFileSync(sourcePath(root, 'places.geojson'));
  const hadLedger = fs.existsSync(ledgerFile);
  const failingCheck = () => {
    throw new Error('forced final failure');
  };
  const edit = () =>
    changeset(root, 'places.geojson', [
      modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'Corrected'))
    ]);
  assert.throws(
    () => applyChangeset(edit(), root, {now: reviewedAt, checkFinalData: failingCheck}),
    /reviewed files restored: forced final failure/
  );
  assert.deepEqual(fs.readFileSync(sourcePath(root, 'places.geojson')), placesBefore);
  assert.equal(fs.existsSync(ledgerFile), hadLedger);
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'data/sources')).filter(name => name.includes('.staged-')),
    []
  );

  applyChangeset(edit(), root, {now: reviewedAt});
  const {version, corrections} = JSON.parse(fs.readFileSync(ledgerFile));
  assert.equal(version, 1);
  const schema = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'packages/contracts/editor-corrections.schema.json'))
  );
  const [correction] = corrections;
  assert.deepEqual(Object.keys(correction).toSorted(), schema.properties.corrections.items.required.toSorted());
  assert.equal(correction.after.properties.name, 'Corrected');
  assert.notEqual(correction.before.properties.name, 'Corrected');
});

test('a modification cannot add a top-level field', testContext => {
  const root = temporaryRoot(testContext);
  const refused = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => (feature.invented = 'x'))
  ]);
  assert.throws(() => applyChangeset(refused, root, {now: reviewedAt}), /feature invented is not editable/);
});

test('a level edit or deletion of a place with a commercial record is refused by name, keeping it', testContext => {
  const root = temporaryRoot(testContext);
  const policyFile = sourcePath(root, 'place-visibility-policy.json');
  const {features} = readSource(root, 'places.geojson');
  const {id, visibilityLevel} = features[0].properties;
  const policy = JSON.parse(fs.readFileSync(policyFile));
  const commercial = {
    id,
    level: 2,
    reason: 'Paid placement under review',
    active: false,
    provenance: {basis: 'commercial', reviewedBy: 'Sales', reviewedAt}
  };
  policy.overrides.push(commercial);
  fs.writeFileSync(policyFile, JSON.stringify(policy, null, 2) + '\n');
  const refused = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => {
      feature.properties.visibilityLevel = visibilityLevel === 3 ? 2 : 3;
    })
  ]);
  assert.throws(() => applyChangeset(refused, root, {now: reviewedAt}), /has a commercial placement/);
  const before = features[0];
  const deletion = {
    filename: 'places.geojson',
    operation: 'delete',
    reference: {featureIndex: 0},
    beforeFingerprint: sha256(JSON.stringify(before)),
    before,
    after: null
  };
  const refusedDeletion = changeset(root, 'places.geojson', [deletion]);
  assert.throws(() => applyChangeset(refusedDeletion, root, {now: reviewedAt}), /has a commercial placement/);
  assert.deepEqual(JSON.parse(fs.readFileSync(policyFile)).overrides, [commercial]);
});

test('a failed staged write leaves every reviewed file untouched, without rewriting any', testContext => {
  const root = temporaryRoot(testContext);
  const placesFile = sourcePath(root, 'places.geojson');
  const placesBefore = fs.readFileSync(placesFile);
  const edit = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'Corrected'))
  ]);
  const realWrite = fs.writeFileSync;
  const reviewedWrites = [];
  testContext.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    if (String(file).includes('.staged-')) throw new Error('ENOSPC: no space left on device');
    reviewedWrites.push(file);
    return realWrite(file, ...rest);
  });
  assert.throws(() => applyChangeset(edit, root, {now: reviewedAt}), /Changeset not applied: ENOSPC/);
  testContext.mock.restoreAll();
  assert.deepEqual(reviewedWrites, []);
  assert.deepEqual(fs.readFileSync(placesFile), placesBefore);
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'data/sources')).filter(name => name.includes('.staged-')),
    []
  );
});

test('a failed rename restores only what was replaced, and names a file it could not restore', testContext => {
  const root = temporaryRoot(testContext);
  const directory = path.join(root, 'data/sources');
  const snapshot = () =>
    Object.fromEntries(fs.readdirSync(directory).map(name => [name, fs.readFileSync(path.join(directory, name))]));
  const original = snapshot();
  const edit = () =>
    changeset(root, 'places.geojson', [
      modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'Corrected'))
    ]);
  const failSecondRename = () => {
    const realRename = fs.renameSync;
    let renameCount = 0;
    testContext.mock.method(fs, 'renameSync', (from, to) => {
      renameCount += 1;
      if (renameCount === 2) throw new Error('rename failed');
      return realRename(from, to);
    });
  };
  failSecondRename();
  assert.throws(() => applyChangeset(edit(), root, {now: reviewedAt}), /Changeset not applied: rename failed\.$/);
  testContext.mock.restoreAll();
  assert.deepEqual(snapshot(), original);

  failSecondRename();
  const realWrite = fs.writeFileSync;
  testContext.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    if (!String(file).includes('.staged-')) throw new Error('restore failed');
    return realWrite(file, ...rest);
  });
  assert.throws(
    () => applyChangeset(edit(), root, {now: reviewedAt}),
    /rename failed\. Could not restore: .*places\.geojson/
  );
});

test('a restore that runs out of disk keeps the file whole, and the refusal says it was not restored', testContext => {
  const root = temporaryRoot(testContext);
  const edit = changeset(root, 'places.geojson', [
    modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'Corrected'))
  ]);
  const realWrite = fs.writeFileSync;
  testContext.mock.method(fs, 'writeFileSync', (file, ...rest) => {
    if (String(file).includes('.restoring-')) throw new Error('ENOSPC: no space left on device');
    return realWrite(file, ...rest);
  });
  const failingCheck = () => {
    throw new Error('forced final failure');
  };
  assert.throws(
    () => applyChangeset(edit, root, {now: reviewedAt, checkFinalData: failingCheck}),
    /reviewed files not fully restored: forced final failure\. Could not restore: .*places\.geojson/
  );
  testContext.mock.restoreAll();
  assert.ok(fs.statSync(sourcePath(root, 'places.geojson')).size > 0, 'the file was not truncated');
  assert.deepEqual(
    fs.readdirSync(path.join(root, 'data/sources')).filter(name => name.includes('.restoring-')),
    []
  );
});

test('a road edit asks for a tile rebuild and passes the data check', testContext => {
  const root = temporaryRoot(testContext);
  const operation = modifyOperation(root, 'roads.geojson', 0, feature => {
    feature.geometry.coordinates[0] = [18.825, 42.278];
  });
  const summary = applyChangeset(changeset(root, 'roads.geojson', [operation]), root, {now: reviewedAt});
  assert.equal(summary.needsTileRebuild, true);
  assert.doesNotThrow(() => checkData(root));
});

test('a refused changeset leaves every reviewed file untouched', async testContext => {
  const root = temporaryRoot(testContext);
  const snapshot = () =>
    Object.fromEntries(
      fs
        .readdirSync(path.join(root, 'data/sources'))
        .map(name => [name, sha256(fs.readFileSync(sourcePath(root, name)))])
    );
  const original = snapshot();
  const refusals = [
    [
      'stale base',
      () => {
        const staleChangeset = changeset(root, 'places.geojson', [
          modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'X'))
        ]);
        staleChangeset.bases['places.geojson'] = '0'.repeat(64);
        return staleChangeset;
      },
      /differs from the base/
    ],
    [
      'stale fingerprint',
      () => {
        const operation = modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = 'X'));
        operation.beforeFingerprint = '0'.repeat(64);
        return changeset(root, 'places.geojson', [operation]);
      },
      /reviewed fingerprint/
    ],
    [
      'blank name',
      () =>
        changeset(root, 'places.geojson', [
          modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.name = ' '))
        ]),
      /name must be nonempty/
    ],
    [
      'identity change',
      () =>
        changeset(root, 'places.geojson', [
          modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.id = 'node/1'))
        ]),
      /id is not editable/
    ],
    [
      'unknown property',
      () =>
        changeset(root, 'places.geojson', [
          modifyOperation(root, 'places.geojson', 0, feature => (feature.properties.invented = 'x'))
        ]),
      /invented is not editable/
    ],
    [
      'read-only file',
      () =>
        changeset(root, 'transport-stops.geojson', [
          modifyOperation(root, 'transport-stops.geojson', 0, feature => (feature.properties.name = 'X'))
        ]),
      /not allowed in transport-stops/
    ],
    [
      'inspect-only kind',
      () => {
        const contextIndex = readSource(root, 'land.geojson').features.findIndex(
          feature => feature.properties.kind === 'context' && feature.geometry.type === 'Polygon'
        );
        return changeset(root, 'land.geojson', [
          modifyOperation(root, 'land.geojson', contextIndex, feature => (feature.properties.name = 'X'))
        ]);
      },
      /inspect-only/
    ],
    [
      'crossed footprint',
      () =>
        changeset(root, 'buildings.geojson', [
          modifyOperation(root, 'buildings.geojson', 0, feature => {
            feature.geometry.coordinates = [
              [
                [19.25, 42.44],
                [19.251, 42.441],
                [19.251, 42.44],
                [19.25, 42.441],
                [19.25, 42.44]
              ]
            ];
          })
        ]),
      /cross or touch/
    ],
    [
      'footprint leaving its label outside',
      () => {
        const footprintIndex = readSource(root, 'building-labels.geojson').features[0].properties.footprintIndex;
        return changeset(root, 'buildings.geojson', [
          modifyOperation(root, 'buildings.geojson', footprintIndex, feature => {
            feature.geometry.coordinates = [
              [
                [19.25, 42.44],
                [19.251, 42.44],
                [19.251, 42.441],
                [19.25, 42.44]
              ]
            ];
          })
        ]);
      },
      /label outside/
    ],
    [
      'fabricated local place',
      () => {
        const localId = 'local:x';
        const after = {
          type: 'Feature',
          geometry: {type: 'Point', coordinates: [19.25, 42.44]},
          properties: {
            id: localId,
            name: 'N',
            category: 'food',
            kind: 'cafe',
            source: 'OpenStreetMap',
            visibilityLevel: 4
          }
        };
        return changeset(root, 'places.geojson', [
          {
            filename: 'places.geojson',
            operation: 'add',
            reference: {localId},
            beforeFingerprint: null,
            before: null,
            after
          }
        ]);
      },
      /must have source/
    ]
  ];
  for (const [name, build, expected] of refusals) {
    await testContext.test(name, () => {
      assert.throws(() => applyChangeset(build(), root, {now: reviewedAt}), expected);
      assert.deepEqual(snapshot(), original);
    });
  }
});
