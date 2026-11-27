import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {copyFile, mkdtemp, rm, readFile, readdir, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {dataSourceDirectory, dataSourceURL, dataToolURL} from '../data-root.mjs';
import {contractURL, readContractJSON} from '../contracts-root.mjs';
import {
  bundleFilesByVersion,
  sourceFiles,
  validateBundleManifest,
  decodeSource,
  loadSourceBundle
} from '../../apps/editor/src/source-data/source-bundle.js';
import {collectionOf} from '../../apps/editor/src/source-data/source-records.js';

const {writeEditorBundle} = await import(dataToolURL('editor-bundle.mjs'));
const editorBundleContractURL = contractURL('editor-bundle.schema.json');
// What the producer of this commit writes. The editor can read it, and may already read a later one.
const producedVersion = readContractJSON('editor-bundle.schema.json').oneOf.at(-1).properties.version.const;

// Serve a produced directory to the unmodified reader without a running server.
async function bundleFileRequest(directory, url) {
  const filename = path.basename(new URL(url).pathname);
  const bytes = await readFile(path.join(directory, filename));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  };
}

// The pending version changes the contract, not the bundle the current producer writes. Real producer/consumer
// integration proves that the reader still loads every revision-bound source unchanged.
test('reviewed source bundle round trips byte-for-byte through the editor consumer', async t => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'cg-map-editor-bundle-'));
  t.after(() => rm(outputDirectory, {recursive: true, force: true}));
  const schema = readContractJSON('editor-bundle.schema.json');
  const version3Files = schema.oneOf
    .find(branch => branch.properties.version.const === 3)
    .properties.layers.items.properties.filename.enum;
  const version4 = schema.oneOf.find(branch => branch.properties.version.const === 4);
  assert.ok(version4, 'the contract declares version 4');
  const version4Files = version4.properties.layers.items.properties.filename.enum;
  assert.deepEqual(version4Files, [...version3Files, 'bridges.geojson', 'railways.geojson'].sort());
  assert.equal(producedVersion, 3);

  const manifest = validateBundleManifest(
    await writeEditorBundle(dataSourceDirectory, outputDirectory, editorBundleContractURL)
  );
  assert.equal(manifest.version, producedVersion);
  assert.deepEqual(
    manifest.layers.map(layer => layer.filename),
    bundleFilesByVersion[producedVersion]
  );
  const sources = await loadSourceBundle(
    pathToFileURL(outputDirectory + path.sep),
    url => bundleFileRequest(outputDirectory, url)
  );
  assert.equal(sources.size, manifest.layers.length);
  for (const metadata of manifest.layers) {
    const original = await readFile(dataSourceURL(metadata.filename));
    const bundled = await readFile(path.join(outputDirectory, metadata.filename));
    assert.deepEqual(bundled, original);
    const decoded = sources.get(metadata.filename).collection;
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
