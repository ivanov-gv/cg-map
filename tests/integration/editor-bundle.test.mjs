import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {copyFile, mkdtemp, rm, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dataSourceDirectory, dataSourceURL, dataToolURL} from '../data-root.mjs';
import {contractURL, readContractJSON} from '../contracts-root.mjs';
import {
  bundleFilesByVersion,
  sourceFiles,
  validateBundleManifest,
  decodeSource
} from '../../apps/editor/src/source-bundle.js';
import {collectionOf} from '../../apps/editor/src/source-records.js';

const {writeEditorBundle} = await import(dataToolURL('editor-bundle.mjs'));
const editorBundleContractURL = contractURL('editor-bundle.schema.json');
// What the producer of this commit writes. The editor can read it, and may already read a later one.
const producedVersion = readContractJSON('editor-bundle.schema.json').oneOf.at(-1).properties.version.const;

// Real producer/consumer integration proves that revision-bound indices refer to unchanged source bytes.
test('reviewed source bundle round trips byte-for-byte through the editor consumer', async t => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const manifest = validateBundleManifest(
    await writeEditorBundle(dataSourceDirectory, outputDirectory, editorBundleContractURL)
  );
  assert.equal(manifest.version, producedVersion);
  assert.deepEqual(
    manifest.layers.map(layer => layer.filename),
    bundleFilesByVersion[producedVersion]
  );
  for (const metadata of manifest.layers) {
    const original = await readFile(dataSourceURL(metadata.filename));
    const bundled = await readFile(path.join(outputDirectory, metadata.filename));
    assert.deepEqual(bundled, original);
    const decoded = await decodeSource(bundled, metadata);
    assert.equal(decoded.features.length, metadata.featureCount);
    assert.deepEqual(decoded, collectionOf(metadata.filename, JSON.parse(original)));
  }
});

test('version-1 bundle from before building entrances still round trips', async t => {
  const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-sources-v1-'));
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-v1-'));
  t.after(() => rm(sourceDirectory, {recursive: true, force: true}));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  for (const filename of bundleFilesByVersion[1]) {
    await copyFile(path.join(dataSourceDirectory, filename), path.join(sourceDirectory, filename));
  }
  const schema = readContractJSON('editor-bundle.schema.json');
  const versionOne = schema.oneOf.find(branch => branch.properties.version.const === 1);
  const versionOneContractPath = path.join(sourceDirectory, 'editor-bundle.schema.json');
  await writeFile(versionOneContractPath, JSON.stringify({properties: {layers: versionOne.properties.layers}}));

  const manifest = validateBundleManifest(
    await writeEditorBundle(sourceDirectory, outputDirectory, versionOneContractPath)
  );
  assert.equal(manifest.version, 1);
  assert.deepEqual(
    manifest.layers.map(layer => layer.filename),
    bundleFilesByVersion[1]
  );
  for (const metadata of manifest.layers) {
    const original = await readFile(dataSourceURL(metadata.filename));
    const bundled = await readFile(path.join(outputDirectory, metadata.filename));
    assert.deepEqual(bundled, original);
    assert.deepEqual(await decodeSource(bundled, metadata), JSON.parse(original));
  }
});

test('producer manifest matches the shared bundle contract for its version', async t => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const manifest = await writeEditorBundle(dataSourceDirectory, outputDirectory, editorBundleContractURL);
  const schema = readContractJSON('editor-bundle.schema.json');
  const versionBranch = schema.oneOf.find(branch => branch.properties.version.const === manifest.version);
  assert.ok(versionBranch, `contract has no version ${manifest.version}`);
  const layerSchema = schema.properties.layers.items;
  const branchLayerSchema = versionBranch.properties.layers.items;
  const contractFiles = branchLayerSchema.properties.filename.enum;
  assert.equal(manifest.version, producedVersion);
  assert.deepEqual(Object.keys(manifest).sort(), [...schema.required].sort());
  assert.equal(manifest.layers.length, versionBranch.properties.layers.minItems);
  assert.equal(manifest.layers.length, versionBranch.properties.layers.maxItems);
  assert.deepEqual([...contractFiles].sort(), bundleFilesByVersion[manifest.version]);
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

test('settlement and border sources join version 2 without changing version 1', () => {
  const addedFiles = ['border-edges.geojson', 'municipalities.geojson', 'settlements.geojson'];
  for (const filename of addedFiles) {
    assert.ok(sourceFiles.includes(filename), filename);
    assert.ok(!bundleFilesByVersion[1].includes(filename), filename);
  }
  assert.equal(bundleFilesByVersion[1].length, 8);
});

test('producer refuses a source file set that differs from the contract', async t => {
  const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-sources-'));
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(sourceDirectory, {recursive: true, force: true}));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const emptyCollection = JSON.stringify({type: 'FeatureCollection', features: []});
  await writeFile(path.join(sourceDirectory, 'unexpected.geojson'), emptyCollection);
  await assert.rejects(writeEditorBundle(sourceDirectory, outputDirectory, editorBundleContractURL), /sources must be exactly/);
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
