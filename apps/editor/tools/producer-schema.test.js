import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import operatingSystem from 'node:os';
import path from 'node:path';
import {bundleFilesByVersion} from '../src/source-data/source-bundle.js';
import {writeProducerBundleSchema} from './producer-schema.mjs';

function sourceDirectoryWith(filenames, t) {
  const directory = fileSystem.mkdtempSync(path.join(operatingSystem.tmpdir(), 'editor-producer-schema-'));
  t.after(() => fileSystem.rmSync(directory, {recursive: true, force: true}));
  for (const filename of filenames) fileSystem.writeFileSync(path.join(directory, filename), '{}');
  return directory;
}

function readSchema(schemaDirectory, sourceDirectory) {
  return JSON.parse(fileSystem.readFileSync(writeProducerBundleSchema(schemaDirectory, sourceDirectory), 'utf8'));
}

test('the bundle check takes the producer files, whether they are version 1 or version 4', t => {
  const schemaDirectory = sourceDirectoryWith([], t);
  for (const version of [1, 4]) {
    const filenames = bundleFilesByVersion[version].filter(filename => filename.endsWith('.geojson'));
    const sourceDirectory = sourceDirectoryWith(filenames, t);
    const schema = readSchema(schemaDirectory, sourceDirectory);
    assert.deepEqual(schema.properties.layers.items.properties.filename.enum, filenames);
  }
});

test('a source file set the editor cannot read is refused before it is bundled', t => {
  const schemaDirectory = sourceDirectoryWith([], t);
  const sourceDirectory = sourceDirectoryWith(['bridges.geojson'], t);
  assert.throws(() => writeProducerBundleSchema(schemaDirectory, sourceDirectory), /do not match a supported bundle/);
});
