import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {decodeSource} from '../src/source-bundle.js';
import {EditSession} from '../src/edit-session.js';
import {buildChangeset} from '../src/changeset.js';
import {operationProblem} from '../src/layer-rules.js';

const readContract = filename => JSON.parse(readFileSync(new URL(`../../../packages/contracts/${filename}`, import.meta.url)));
const fixture = readContract('fixtures/entity-identity-cases.json');
const rules = readContract('editor-layers.json');
const levels = new Set(readContract('place-visibility.json').levels.map(entry => entry.level));

for (const [filename, collection] of Object.entries(fixture.sources)) {
  test(`editor decodes source identity unchanged in ${filename}`, async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(collection));
    const metadata = {filename, bytes: bytes.length, featureCount: 1, sha256: createHash('sha256').update(bytes).digest('hex')};
    assert.deepEqual(await decodeSource(bytes, metadata), collection);
  });
}

for (const {name, properties} of fixture.valid) {
  test(`editor preserves and locks identity through edit and export for ${name}`, async () => {
    const feature = structuredClone(fixture.sources['places.geojson'].features[0]);
    Object.assign(feature.properties, properties);
    const filename = 'places.geojson';
    const sources = new Map([[filename, {
      metadata: {sha256: 'a'.repeat(64)},
      collection: {type: 'FeatureCollection', features: [feature]}
    }]]);
    const session = new EditSession(sources);
    const after = structuredClone(feature);
    after.properties.name = 'Reviewed cafe';
    session.recordEdit(filename, '0', after);
    const changeset = await buildChangeset(session, sources, {
      id: 'identity-test', author: 'Reviewer', reason: 'Name correction', createdAt: '2026-11-08T00:00:00Z'
    });
    const [operation] = changeset.operations;
    assert.equal(operationProblem(operation, rules, levels), null);
    assert.deepEqual(operation.before, feature);
    assert.deepEqual(operation.after, after);
    for (const field of ['entityId', 'entityVersion', 'entityPart']) {
      const invalid = structuredClone(operation);
      invalid.after.properties[field] = field === 'entityId' ? 'node/999' : 999;
      assert.match(operationProblem(invalid, rules, levels), /is not editable/);
    }
    session.undo(filename);
    assert.equal(session.changes(filename).length, 0);
    session.redo(filename);
    assert.deepEqual(session.changes(filename)[0].after, after);
  });
}
