import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {categories} from '../web/core.js';

function requireValue(ok, message) { if (!ok) throw new Error(message); }
function position(point, label) {
  requireValue(Array.isArray(point) && point.length >= 2 && point.every(Number.isFinite), `${label}: invalid position`);
  requireValue(Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90, `${label}: coordinates must be WGS84 longitude, latitude`);
}
function line(points, label, ring = false) {
  requireValue(Array.isArray(points) && points.length >= (ring ? 4 : 2), `${label}: insufficient coordinates`);
  points.forEach(p => position(p, label));
  if (ring) requireValue(JSON.stringify(points[0]) === JSON.stringify(points.at(-1)), `${label}: polygon ring is not closed`);
}
function geometry(g, label) {
  requireValue(g && Array.isArray(g.coordinates), `${label}: missing geometry`);
  switch (g.type) {
    case 'Point': position(g.coordinates, label); break;
    case 'MultiPoint': requireValue(g.coordinates.length > 0, `${label}: empty points`); g.coordinates.forEach(p => position(p, label)); break;
    case 'LineString': line(g.coordinates, label); break;
    case 'MultiLineString': requireValue(g.coordinates.length > 0, `${label}: empty lines`); g.coordinates.forEach(p => line(p, label)); break;
    case 'Polygon': requireValue(g.coordinates.length > 0, `${label}: empty polygon`); g.coordinates.forEach(p => line(p, label, true)); break;
    case 'MultiPolygon': requireValue(g.coordinates.length > 0, `${label}: empty polygons`); g.coordinates.forEach(p => geometry({type: 'Polygon', coordinates: p}, label)); break;
    default: throw new Error(`${label}: unsupported geometry ${g.type}`);
  }
}
export function validateCollection(data, {places = false, label = 'GeoJSON', geometryTypes, requireKind = false} = {}) {
  requireValue(data?.type === 'FeatureCollection' && Array.isArray(data.features), `${label}: expected FeatureCollection`);
  const ids = new Set();
  for (const [i, f] of data.features.entries()) {
    const name = `${label} feature ${i}`;
    requireValue(f.type === 'Feature' && f.properties && typeof f.properties === 'object', `${name}: invalid feature`);
    geometry(f.geometry, name);
    if (geometryTypes) requireValue(geometryTypes.includes(f.geometry.type), `${name}: geometry type violates layer contract`);
    if (requireKind) requireValue(typeof f.properties.kind === 'string' && f.properties.kind.length > 0, `${name}: missing kind`);
    if (places) {
      const p = f.properties;
      requireValue(f.geometry.type === 'Point', `${name}: places must be points`);
      requireValue(typeof p.id === 'string' && p.id.length > 0 && !ids.has(p.id), `${name}: missing or duplicate place id`);
      ids.add(p.id);
      requireValue(typeof p.name === 'string' && p.name.trim().length > 0, `${name}: missing place name`);
      requireValue(Object.hasOwn(categories, p.category) && p.category !== 'all', `${name}: unknown category`);
    }
  }
  return data.features.length;
}
export function checkData(root = '.') {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'source-data/provenance.json')));
  requireValue(Number.isFinite(Date.parse(provenance.upstream_snapshot)) && typeof provenance.coverage === 'string', 'Source timestamp/coverage missing');
  for (const [name, expected] of Object.entries(provenance.layers)) {
    requireValue(/^[\w-]+\.geojson$/.test(name), 'Unsafe provenance layer path');
    const bytes = fs.readFileSync(path.join(root, 'source-data', name));
    const geometryTypes = name === 'roads.geojson' ? ['LineString', 'MultiLineString'] : name === 'water.geojson' ? ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'] : ['Polygon', 'MultiPolygon'];
    const count = validateCollection(JSON.parse(bytes), {label: name, geometryTypes, requireKind: true});
    requireValue(count === expected.features && bytes.length === expected.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha256,
      `${name}: provenance mismatch. Review the dataset and update source-data/provenance.json.`);
  }
  requireValue(provenance.places_file === 'web/data/places.geojson', 'Unexpected places_file');
  const count = validateCollection(JSON.parse(fs.readFileSync(path.join(root, provenance.places_file))), {places: true, label: 'places'});
  requireValue(count === provenance.places_count, 'Place count differs from reviewed provenance');
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Validated geometry, source hashes, and ${checkData()} places. This is structural validation, not GIS topology validation.`);
}
