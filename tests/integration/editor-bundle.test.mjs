import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp, rm, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeEditorBundle} from '../../data/tools/editor-bundle.mjs';
import {sourceFiles, validateBundleManifest, decodeSource} from '../../apps/editor/src/source-bundle.js';

// Real producer/consumer integration proves that revision-bound indices refer to unchanged source bytes.
test('reviewed source bundle round trips byte-for-byte through the editor consumer', async t => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const sourceDirectory = new URL('../../data/sources/', import.meta.url);
  const manifest = validateBundleManifest(await writeEditorBundle(fileURLToPath(sourceDirectory), outputDirectory));
  assert.deepEqual(
    manifest.layers.map(layer => layer.filename),
    sourceFiles
  );
  for (const metadata of manifest.layers) {
    const original = await readFile(new URL(metadata.filename, sourceDirectory));
    const bundled = await readFile(path.join(outputDirectory, metadata.filename));
    assert.deepEqual(bundled, original);
    const decoded = await decodeSource(bundled, metadata);
    assert.equal(decoded.features.length, metadata.featureCount);
    assert.deepEqual(decoded, JSON.parse(original));
  }
});

test('producer manifest matches the shared bundle contract', async t => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const sourceDirectory = fileURLToPath(new URL('../../data/sources/', import.meta.url));
  const manifest = await writeEditorBundle(sourceDirectory, outputDirectory);
  const schema = JSON.parse(
    await readFile(new URL('../../packages/contracts/editor-bundle.schema.json', import.meta.url))
  );
  const layerSchema = schema.properties.layers.items;
  const contractFiles = layerSchema.properties.filename.enum;
  assert.equal(manifest.version, schema.properties.version.const);
  assert.deepEqual(Object.keys(manifest).sort(), [...schema.required].sort());
  assert.equal(manifest.layers.length, schema.properties.layers.minItems);
  assert.equal(manifest.layers.length, schema.properties.layers.maxItems);
  assert.deepEqual([...contractFiles].sort(), sourceFiles);
  for (const layer of manifest.layers) {
    assert.deepEqual(Object.keys(layer).sort(), [...layerSchema.required].sort());
    assert.ok(contractFiles.includes(layer.filename), layer.filename);
    assert.match(layer.sha256, new RegExp(layerSchema.properties.sha256.pattern));
    assert.ok(Number.isInteger(layer.bytes) && layer.bytes >= layerSchema.properties.bytes.minimum, layer.filename);
    assert.ok(
      Number.isInteger(layer.featureCount) && layer.featureCount >= layerSchema.properties.featureCount.minimum,
      layer.filename
    );
  }
});

test('producer refuses a source file set that differs from the contract', async t => {
  const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-sources-'));
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(sourceDirectory, {recursive: true, force: true}));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const emptyCollection = JSON.stringify({type: 'FeatureCollection', features: []});
  await writeFile(path.join(sourceDirectory, 'unexpected.geojson'), emptyCollection);
  await assert.rejects(writeEditorBundle(sourceDirectory, outputDirectory), /sources must be exactly/);
  assert.deepEqual(await readdir(outputDirectory), []);
});

test('public artifact includes the shared runtime and excludes editor source bundles', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../dist/web/data/manifest.json', import.meta.url)));
  for (const filename of ['index.js', 'map.js', 'map-style.js', 'satellite.js', 'place-visibility.js']) {
    assert.ok(manifest.shell.includes(`map-core/${filename}`), filename);
  }
  assert.ok(manifest.shell.every(filename => !filename.startsWith('sources/') && !filename.includes('editor')));
  // The offline manifest only lists cached files, so also check what the deployment would upload.
  assert.equal(existsSync(new URL('../../dist/web/sources', import.meta.url)), false);
  const publishedData = await readdir(new URL('../../dist/web/data/', import.meta.url));
  const publishedSources = publishedData.filter(filename => filename.endsWith('.geojson')).sort();
  assert.deepEqual(publishedSources, ['building-labels.geojson', 'places.geojson', 'transport-stops.geojson']);
});
