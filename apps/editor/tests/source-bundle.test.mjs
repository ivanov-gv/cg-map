import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  bundleFilesByVersion,
  currentBundleVersion,
  sourceFiles,
  validateBundleManifest,
  decodeSource,
  loadSourceBundle
} from '../src/source-bundle.js';

const collection = {type: 'FeatureCollection', features: []};
const bytes = new TextEncoder().encode(JSON.stringify(collection));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = filename => ({filename, sha256, bytes: bytes.length, featureCount: 0});
const manifest = (version = currentBundleVersion) => ({version, layers: bundleFilesByVersion[version].map(metadata)});

test('manifest accepts every bundle version and requires one entry per supported filename', () => {
  assert.deepEqual(bundleFilesByVersion[1], [
    'building-labels.geojson',
    'buildings.geojson',
    'context-countries.geojson',
    'land.geojson',
    'places.geojson',
    'roads.geojson',
    'transport-stops.geojson',
    'water.geojson'
  ]);
  assert.deepEqual(bundleFilesByVersion[2], [
    'border-edges.geojson',
    'building-entrances.geojson',
    'building-labels.geojson',
    'buildings.geojson',
    'context-countries.geojson',
    'land.geojson',
    'municipalities.geojson',
    'places.geojson',
    'road-nodes.geojson',
    'roads.geojson',
    'settlements.geojson',
    'transport-stops.geojson',
    'water.geojson'
  ]);
  const addedInVersion3 = bundleFilesByVersion[3].filter(filename => !bundleFilesByVersion[2].includes(filename));
  assert.deepEqual(addedInVersion3, [
    'canyon-rims.geojson',
    'contours.geojson',
    'protected-areas.geojson',
    'ridges.geojson',
    'settlement-areas.geojson',
    'slopes.geojson',
    'summits.geojson',
    'transit-routes.json',
    'turn-restrictions.json'
  ]);
  for (const version of [1, 2, 3]) {
    assert.equal(
      validateBundleManifest(manifest(version)).layers.length,
      bundleFilesByVersion[version].length
    );
  }
  const duplicate = manifest();
  duplicate.layers[1] = duplicate.layers[0];
  assert.throws(() => validateBundleManifest(duplicate), /exactly the 22/);
  const v1WithEntrance = manifest(1);
  v1WithEntrance.layers.push(metadata('building-entrances.geojson'));
  assert.throws(() => validateBundleManifest(v1WithEntrance), /exactly the 8/);
  const withoutFile = filename => ({
    version: 3,
    layers: sourceFiles.filter(entry => entry !== filename).map(metadata)
  });
  for (const filename of ['building-entrances.geojson', 'settlements.geojson']) {
    assert.throws(() => validateBundleManifest(withoutFile(filename)), /exactly the 22/);
  }
  for (const invalid of [
    {version: 4, layers: sourceFiles.map(metadata)},
    {version: 1, layers: []},
    {version: 1, layers: bundleFilesByVersion[2].map(metadata)}
  ]) {
    assert.throws(() => validateBundleManifest(invalid));
  }
  const invalidHash = manifest();
  invalidHash.layers[0].sha256 = 'bad';
  assert.throws(() => validateBundleManifest(invalidHash), /Invalid source metadata/);
});

test('source decoding binds bytes, digest, feature count and collection type', async () => {
  assert.deepEqual(await decodeSource(bytes, metadata('places.geojson')), collection);
  await assert.rejects(
    decodeSource(new TextEncoder().encode('changed'), metadata('places.geojson')),
    /integrity mismatch/
  );
  await assert.rejects(
    decodeSource(bytes, {...metadata('places.geojson'), featureCount: 1}),
    /Invalid source collection/
  );
  await assert.rejects(
    decodeSource(bytes, {...metadata('places.geojson'), bytes: bytes.length + 1}),
    /integrity mismatch/
  );
});

test('source decoding explains that hashing needs a secure context', async testContext => {
  const secureCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  testContext.after(() => Object.defineProperty(globalThis, 'crypto', secureCrypto));
  Object.defineProperty(globalThis, 'crypto', {value: {}, configurable: true});
  await assert.rejects(decodeSource(bytes, metadata('places.geojson')), /needs HTTPS or localhost/);
});

test('bundle consumer reports manifest and source HTTP failures', async () => {
  const bundle = await loadSourceBundle('https://local.test/sources/', async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest());
    return new Response(bytes);
  });
  assert.deepEqual([...bundle.keys()], sourceFiles);
  await assert.rejects(
    loadSourceBundle('https://local.test/sources/', async () => new Response('', {status: 503})),
    /HTTP 503/
  );
  await assert.rejects(
    loadSourceBundle('https://local.test/sources/', async url =>
      url.pathname.endsWith('manifest.json') ? Response.json(manifest()) : new Response('', {status: 404})
    ),
    /HTTP 404/
  );
});

test('decoding preserves unknown properties and original upstream identities', async () => {
  const feature = {
    type: 'Feature',
    id: 'upstream:42',
    properties: {name: 'Source', custom: {license: 'preserved'}},
    geometry: {type: 'Point', coordinates: [19.2, 42.4]}
  };
  const original = {type: 'FeatureCollection', features: [feature]};
  const sourceBytes = new TextEncoder().encode(JSON.stringify(original));
  const sourceMetadata = {
    filename: 'places.geojson',
    bytes: sourceBytes.length,
    featureCount: 1,
    sha256: createHash('sha256').update(sourceBytes).digest('hex')
  };
  assert.deepEqual(await decodeSource(sourceBytes, sourceMetadata), original);
});
