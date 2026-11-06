import {sha256Hex} from './hashing.js';

// One entry per editing mode, sorted. The shared contract and the bundle producer list the same files.
export const sourceFiles = [
  'building-labels.geojson',
  'buildings.geojson',
  'context-countries.geojson',
  'land.geojson',
  'places.geojson',
  'roads.geojson',
  'transport-stops.geojson',
  'water.geojson'
];

// Reject unknown/duplicate/missing sources rather than silently providing incomplete editing modes.
export function validateBundleManifest(manifest) {
  const isSupportedVersion = manifest?.version === 1 && Array.isArray(manifest.layers);
  if (!isSupportedVersion) throw new Error('Unsupported source bundle.');
  const filenames = manifest.layers.map(layer => layer.filename).sort();
  const hasEverySourceOnce = JSON.stringify(filenames) === JSON.stringify(sourceFiles);
  if (!hasEverySourceOnce) throw new Error('Source bundle must contain exactly the eight supported GeoJSON files.');
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
  const collection = JSON.parse(new TextDecoder().decode(bytes));
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
