import {sha256Hex} from '../shared/hashing.js';
import {collectionOf} from './source-records.js';

// Every version is frozen: a reviewed bundle of an earlier one stays readable.
const version1Files = [
  'building-labels.geojson',
  'buildings.geojson',
  'context-countries.geojson',
  'land.geojson',
  'places.geojson',
  'roads.geojson',
  'transport-stops.geojson',
  'water.geojson'
];
const version2Files = [
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
];
const version3Files = [
  'border-edges.geojson',
  'building-entrances.geojson',
  'building-labels.geojson',
  'buildings.geojson',
  'canyon-rims.geojson',
  'context-countries.geojson',
  'contours.geojson',
  'land.geojson',
  'municipalities.geojson',
  'places.geojson',
  'protected-areas.geojson',
  'ridges.geojson',
  'road-nodes.geojson',
  'roads.geojson',
  'settlement-areas.geojson',
  'settlements.geojson',
  'slopes.geojson',
  'summits.geojson',
  'transit-routes.json',
  'transport-stops.geojson',
  'turn-restrictions.json',
  'water.geojson'
];
// Slopes are derived from ridges and light/shade now, so version 4 carries the two editable source files instead.
const version4Files = [...version3Files, 'bridges.geojson', 'railways.geojson']
  .filter(filename => filename !== 'slopes.geojson')
  .sort();

export const bundleFilesByVersion = {
  1: version1Files,
  2: version2Files,
  3: version3Files,
  4: version4Files
};

// The reviewed producer still emits version 3; version 4 is ready to read when it emits it.
export const currentBundleVersion = 3;
export const sourceFiles = bundleFilesByVersion[currentBundleVersion];

// Reject unknown/duplicate/missing sources rather than silently providing incomplete editing modes.
export function validateBundleManifest(manifest) {
  const expectedFiles = bundleFilesByVersion[manifest?.version];
  if (!expectedFiles || !Array.isArray(manifest.layers)) throw new Error('Unsupported source bundle.');
  const filenames = manifest.layers.map(layer => layer.filename).sort();
  const hasEverySourceOnce = JSON.stringify(filenames) === JSON.stringify([...expectedFiles].sort());
  if (!hasEverySourceOnce) {
    throw new Error(`Source bundle must contain exactly the ${expectedFiles.length} supported files.`);
  }
  for (const layer of manifest.layers) {
    const hasValidMetadata =
      /^[a-f0-9]{64}$/.test(layer.sha256) &&
      Number.isSafeInteger(layer.bytes) &&
      layer.bytes > 0 &&
      Number.isSafeInteger(layer.featureCount) &&
      layer.featureCount >= 0;
    if (!hasValidMetadata) throw new Error(`Invalid source metadata: ${layer.filename}`);
  }
  return manifest;
}

// Hash raw bytes before parsing: source indices are meaningful only within the pinned snapshot.
export async function decodeSource(bytes, metadata) {
  // Browsers expose crypto.subtle only on HTTPS and localhost; name that instead of a TypeError.
  if (!crypto.subtle) throw new Error('Source verification needs HTTPS or localhost.');
  const sha256 = await sha256Hex(bytes);
  if (bytes.byteLength !== metadata.bytes || sha256 !== metadata.sha256) {
    throw new Error(`Source integrity mismatch: ${metadata.filename}. Rebuild the source bundle.`);
  }
  const collection = collectionOf(metadata.filename, JSON.parse(new TextDecoder().decode(bytes)));
  const hasValidCollection =
    collection?.type === 'FeatureCollection' &&
    Array.isArray(collection.features) &&
    collection.features.length === metadata.featureCount;
  if (!hasValidCollection) throw new Error(`Invalid source collection: ${metadata.filename}`);
  return collection;
}

// No APIs: a separately built local source bundle is the sole editable-data input.
export async function loadSourceBundle(baseURL, request = fetch) {
  const manifestResponse = await request(new URL('manifest.json', baseURL));
  if (!manifestResponse.ok) throw new Error(`Source bundle: HTTP ${manifestResponse.status}`);
  const manifest = validateBundleManifest(await manifestResponse.json());
  const entries = await Promise.all(
    manifest.layers.map(async metadata => {
      const response = await request(new URL(metadata.filename, baseURL));
      if (!response.ok) throw new Error(`${metadata.filename}: HTTP ${response.status}`);
      const collection = await decodeSource(await response.arrayBuffer(), metadata);
      return [metadata.filename, {metadata, collection}];
    })
  );
  return new Map(entries);
}
