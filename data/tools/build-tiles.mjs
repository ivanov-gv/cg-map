import fs from 'node:fs';
import path from 'node:path';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {fileURLToPath} from 'node:url';
import {MAX_GENERATED_ZOOM, MAX_TILE_ZOOM, TILE_LAYERS, tileLayerMetadata} from './tile-layers.mjs';
import {greenAreaTest} from './green-areas.mjs';
import {greenAreaLabelLines} from './green-area-labels.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tileDirectory = path.join(root, '.build/tiles');
const sourceDirectory = path.join(root, 'data/sources');
const tileExtent = 8192;
const tileBounds = [18.35, 41.75, 20.4, 43.6];
const zoomBands = [[0, 8], [9, 12], [13, 16]];

fs.mkdirSync(tileDirectory, {recursive: true});

// Empty strings would make TileJSON fields look present in a style's `has` expressions.
function selectedProperties(properties, fields) {
  const selected = {};
  for (const field of fields) {
    const value = properties[field];
    if (value === undefined || value === null || value === '') continue;
    selected[field] = value;
  }
  return selected;
}

function municipalityLabel(feature, fields) {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: feature.properties.labelPoint},
    properties: selectedProperties(feature.properties, fields)
  };
}

function readSource(fileName) {
  return JSON.parse(fs.readFileSync(path.join(sourceDirectory, fileName), 'utf8'));
}

// The relief build's reviewed list of green land kinds; derived layers use it so all agree on what is green.
function greenKinds() {
  return readSource('provenance.json').relief.buildParameters.greenKinds;
}

// Paths through parks and woods are drawn as park routes.
function roadsWithGreenAreaFlag(roads) {
  const isInGreenArea = greenAreaTest(readSource('land.geojson').features, greenKinds());
  return roads.map(road => {
    if (!isInGreenArea(road)) return road;
    return {...road, properties: {...road.properties, inGreenArea: true}};
  });
}

function layerFeatures(layer, collection) {
  if (layer.name === 'municipalities') {
    return collection.features.map(feature => municipalityLabel(feature, layer.fields));
  }
  if (layer.name === 'green_area_labels') {
    return greenAreaLabelLines(collection.features, greenKinds()).map(line => ({
      ...line,
      properties: selectedProperties(line.properties, layer.fields)
    }));
  }
  const sourceFeatures = layer.name === 'roads' ? roadsWithGreenAreaFlag(collection.features) : collection.features;
  return sourceFeatures.map(feature => ({
    type: 'Feature',
    id: feature.id,
    geometry: feature.geometry,
    properties: selectedProperties(feature.properties, layer.fields)
  }));
}

function buildIndex(layer) {
  const collection = readSource(layer.sourceFile);
  const features = layerFeatures(layer, collection);
  const index = geojsonvt({type: 'FeatureCollection', features}, {
    maxZoom: MAX_TILE_ZOOM,
    indexMaxZoom: 5,
    indexMaxPoints: 50000,
    tolerance: 2,
    extent: tileExtent,
    buffer: 128,
    generateId: true
  });
  console.log(layer.name, features.length);
  return index;
}

function recordLayerBytes(stats, layerName, zoom, bytes) {
  const layerStats = stats.layers[layerName] ??= {bytes: 0, byZoom: {}};
  layerStats.bytes += bytes;
  layerStats.byZoom[zoom] = (layerStats.byZoom[zoom] ?? 0) + bytes;
}

function encodeLayer(layer, index, tileX, tileY, zoom, stats) {
  if (zoom < layer.minZoom) return null;
  const tile = index.getTile(zoom, tileX, tileY);
  if (!tile?.features.length) return null;
  const features = layer.keep ? tile.features.filter(feature => layer.keep(feature.tags, zoom)) : tile.features;
  if (!features.length) return null;
  const buffer = vtpbf.fromGeojsonVt({[layer.name]: {...tile, features}}, {extent: tileExtent});
  recordLayerBytes(stats, layer.name, zoom, buffer.length);
  return buffer;
}

function longitudeTile(longitude, zoom) {
  return Math.floor((longitude + 180) / 360 * 2 ** zoom);
}

function latitudeTile(latitude, zoom) {
  const latitudeRadians = latitude * Math.PI / 180;
  return Math.floor((1 - Math.asinh(Math.tan(latitudeRadians)) / Math.PI) / 2 * 2 ** zoom);
}

function printLayerBytes(stats) {
  console.log('Encoded layer bytes by zoom band (0-8, 9-12, 13-16, total):');
  for (const layer of TILE_LAYERS) {
    const layerStats = stats.layers[layer.name] ?? {byZoom: {}, bytes: 0};
    const cells = zoomBands.map(([firstZoom, lastZoom]) => {
      let bandBytes = 0;
      for (let zoom = firstZoom; zoom <= lastZoom; zoom++) bandBytes += layerStats.byZoom[zoom] ?? 0;
      return bandBytes;
    });
    console.log(layer.name.padEnd(15), ...cells.map(bytes => String(bytes).padStart(9)), String(layerStats.bytes).padStart(10));
  }
}

const indexes = new Map(TILE_LAYERS.map(layer => [layer.name, buildIndex(layer)]));
const manifest = [];
const stats = {layers: {}, tiles: 0};
for (let zoom = 0; zoom <= MAX_GENERATED_ZOOM; zoom++) {
  const [west, south, east, north] = tileBounds;
  for (let tileX = longitudeTile(west, zoom); tileX <= longitudeTile(east, zoom); tileX++) {
    for (let tileY = latitudeTile(north, zoom); tileY <= latitudeTile(south, zoom); tileY++) {
      const encodedLayers = TILE_LAYERS
        .map(layer => encodeLayer(layer, indexes.get(layer.name), tileX, tileY, zoom, stats))
        .filter(Boolean);
      if (!encodedLayers.length) continue;
      const fileName = `${zoom}-${tileX}-${tileY}.pbf`;
      fs.writeFileSync(path.join(tileDirectory, fileName), Buffer.concat(encodedLayers));
      manifest.push({z: zoom, x: tileX, y: tileY, file: fileName});
    }
  }
  console.log('zoom', zoom, 'total tiles', manifest.length);
}

stats.tiles = manifest.length;
fs.writeFileSync(path.join(tileDirectory, 'tiles.json'), JSON.stringify(manifest));
fs.writeFileSync(path.join(tileDirectory, 'layer-metadata.json'), JSON.stringify(tileLayerMetadata(), null, 2));
fs.writeFileSync(path.join(tileDirectory, 'layer-stats.json'), JSON.stringify(stats, null, 2));
printLayerBytes(stats);
