import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sourceFiles, validateBundleManifest, decodeSource, loadSourceBundle} from '../src/source-bundle.js';

const collection = {type: 'FeatureCollection', features: []};
const bytes = new TextEncoder().encode(JSON.stringify(collection));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const metadata = filename => ({filename, sha256, bytes: bytes.length, featureCount: 0});
const manifest = () => ({version: 1, layers: sourceFiles.map(metadata)});

test('manifest requires exactly one entry per source filename and valid metadata', () => {
  assert.equal(validateBundleManifest(manifest()).layers.length, 8);
  const duplicate = manifest();
  duplicate.layers[1] = duplicate.layers[0];
  assert.throws(() => validateBundleManifest(duplicate), /exactly the eight/);
  for (const invalid of [{version: 2}, {version: 1, layers: []}]) {
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

test('source decoding explains that hashing needs a secure context', async t => {
  const secureCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  t.after(() => Object.defineProperty(globalThis, 'crypto', secureCrypto));
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
