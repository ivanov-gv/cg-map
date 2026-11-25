import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {PMTiles} from 'pmtiles';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {dataToolURL} from '../data-root.mjs';

const {MAX_TILE_ZOOM, TILE_LAYERS, tileLayerMetadata} = await import(dataToolURL('tile-layers.mjs'));

const webDirectory = path.resolve('dist/web');
const manifest = JSON.parse(fs.readFileSync(path.join(webDirectory, 'data/manifest.json'), 'utf8'));
const archiveBytes = fs.readFileSync(path.join(webDirectory, manifest.archive.path));
const archiveSource = {
  getKey: () => manifest.archive.path,
  getBytes: async (offset, length) => ({
    data: archiveBytes.buffer.slice(
      archiveBytes.byteOffset + offset,
      archiveBytes.byteOffset + Math.min(offset + length, archiveBytes.length)
    )
  })
};
const archive = new PMTiles(archiveSource);
const podgorica = {longitude: 19.26, latitude: 42.437};
const existingLayers = new Set(['land', 'water', 'roads', 'buildings']);
// These fields are present only on some source features, so the sampled Podgorica tile can omit them.
const optionalFieldsByLayer = new Map([
  ['summits', new Set(['name:en'])],
  ['road_nodes', new Set(['name'])],
  ['entrances', new Set(['ref', 'level', 'door', 'wheelchair'])]
]);

function tileCoordinate(zoom) {
  const latitudeRadians = podgorica.latitude * Math.PI / 180;
  return [
    Math.floor((podgorica.longitude + 180) / 360 * 2 ** zoom),
    Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * 2 ** zoom)
  ];
}

async function decodedTile(zoom) {
  const [tileX, tileY] = tileCoordinate(zoom);
  const tile = await archive.getZxy(zoom, tileX, tileY);
  assert.ok(tile, `Podgorica tile ${zoom}/${tileX}/${tileY} must exist`);
  return new VectorTile(new Pbf(tile.data));
}

function layerFeatures(decoded, layerName) {
  const layer = decoded.layers[layerName];
  if (!layer) return [];
  return Array.from({length: layer.length}, (_, index) => layer.feature(index));
}

function observedFields(features) {
  return new Set(features.flatMap(feature => Object.keys(feature.properties)));
}

for (const layer of TILE_LAYERS.filter(definition => !existingLayers.has(definition.name))) {
  test(`${layer.name} starts at zoom ${layer.minZoom} with only its documented fields`, async () => {
    const atMinZoom = await decodedTile(layer.minZoom);
    const features = layerFeatures(atMinZoom, layer.name);
    assert.ok(features.length > 0, `${layer.name} must have a feature at its minimum zoom`);

    const belowMinZoom = await decodedTile(layer.minZoom - 1);
    assert.equal(
      layerFeatures(belowMinZoom, layer.name).length,
      0,
      `${layer.name} must be absent at zoom ${layer.minZoom - 1}`
    );

    const fields = observedFields(features);
    const optionalFields = optionalFieldsByLayer.get(layer.name) ?? new Set();
    const missingFields = layer.fields.filter(
      field => !fields.has(field) && !optionalFields.has(field)
    );
    assert.deepEqual(missingFields, [], `${layer.name} must carry its required fields`);
    for (const field of fields) {
      assert.ok(layer.fields.includes(field), `${layer.name} must not publish undocumented field ${field}`);
    }
  });
}

test('archive metadata describes every layer from the shared tile definitions', async () => {
  const metadata = await archive.getMetadata();
  assert.deepEqual(metadata.vector_layers, tileLayerMetadata().vector_layers);
});

test('archive metadata keeps the archive name from the shared definition', async () => {
  const metadata = await archive.getMetadata();
  assert.equal(metadata.name, tileLayerMetadata().name);
});

test('archive metadata credits the reviewed relief source', async () => {
  const metadata = await archive.getMetadata();
  assert.ok(metadata.description.includes('Copernicus DEM GLO-30'));
});

test('archive metadata carries the adapted DEM notice', async () => {
  const metadata = await archive.getMetadata();
  assert.ok(metadata.attribution.includes('produced using Copernicus WorldDEM-30'));
});

test('archive metadata advertises each layer minimum zoom', async () => {
  const metadata = await archive.getMetadata();
  for (const layer of TILE_LAYERS) {
    const entry = metadata.vector_layers.find(value => value.id === layer.name);
    assert.equal(entry.minzoom, layer.minZoom, layer.name);
  }
});

test('archive metadata advertises the shared maximum zoom for every layer', async () => {
  const metadata = await archive.getMetadata();
  for (const layer of TILE_LAYERS) {
    const entry = metadata.vector_layers.find(value => value.id === layer.name);
    assert.equal(entry.maxzoom, MAX_TILE_ZOOM, layer.name);
  }
});

test('canyon rims carry one whole-metre height alongside their river and bank', async () => {
  const rims = TILE_LAYERS.find(({name}) => name === 'canyon_rims');
  const atMinZoom = await decodedTile(rims.minZoom);
  const features = layerFeatures(atMinZoom, 'canyon_rims');
  assert.ok(features.length > 0, 'the sampled tile contains a canyon rim');
  for (const feature of features) {
    assert.ok(Number.isInteger(feature.properties.height), 'the archive height is a whole number of metres');
    assert.equal(typeof feature.properties.river, 'string');
    assert.equal(typeof feature.properties.bank, 'string');
  }
});
