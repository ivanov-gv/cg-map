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
} from './source-bundle.js';

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
  const addedInVersion4 = bundleFilesByVersion[4].filter(filename => !bundleFilesByVersion[3].includes(filename));
  const leftOutInVersion4 = bundleFilesByVersion[3].filter(filename => !bundleFilesByVersion[4].includes(filename));
  assert.deepEqual(addedInVersion4, ['bridges.geojson', 'railways.geojson']);
  assert.deepEqual(leftOutInVersion4, ['slopes.geojson']);
  assert.equal(bundleFilesByVersion[4].length, 23);
  assert.deepEqual(bundleFilesByVersion[5], [
    'bridges.geojson',
    'buildings.geojson',
    'canyon-rims.geojson',
    'places.geojson',
    'railways.geojson',
    'relief.geojson',
    'roads.geojson',
    'settlements.geojson',
    'surface.geojson',
    'transit-network.json',
    'transit-routes.json',
    'transport-stops.geojson'
  ]);
  assert.equal(currentBundleVersion, 3, 'the producer still emits version 3');
  for (const version of [1, 2, 3, 4, 5]) {
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
    {version: 5, layers: sourceFiles.map(metadata)},
    {version: 4, layers: bundleFilesByVersion[4].map(metadata).slice(1)},
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

test('a version 3 bundle keeps its reviewed file set and manifest version', async () => {
  const bundle = await loadSourceBundle('https://local.test/v3/', async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest(3));
    return new Response(bytes);
  });
  assert.deepEqual([...bundle.keys()], bundleFilesByVersion[3]);
  assert.equal(bundle.manifest.version, 3);
  assert.ok(bundle.has('water.geojson'));
  assert.equal(bundle.has('surface.geojson'), false);
});

test('a version 5 bundle loads the whole surface and its verified manifest', async () => {
  const bundle = await loadSourceBundle('https://local.test/v5/', async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest(5));
    return new Response(bytes);
  });
  assert.deepEqual([...bundle.keys()], bundleFilesByVersion[5]);
  assert.equal(bundle.manifest.version, 5);
  assert.ok(bundle.has('surface.geojson'));
  assert.ok(bundle.has('transit-network.json'));
  assert.equal(bundle.has('water.geojson'), false);
});

test('a version 4 bundle loads its bridges and railways without the derived slopes', async () => {
  const bundle = await loadSourceBundle('https://local.test/v4/', async url => {
    if (url.pathname.endsWith('manifest.json')) return Response.json(manifest(4));
    return new Response(bytes);
  });
  assert.deepEqual([...bundle.keys()], bundleFilesByVersion[4]);
  assert.ok(bundle.has('bridges.geojson'));
  assert.ok(bundle.has('railways.geojson'));
  assert.equal(bundle.has('slopes.geojson'), false);
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
