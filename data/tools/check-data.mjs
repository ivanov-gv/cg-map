import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const rootDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract=JSON.parse(fs.readFileSync(path.join(rootDirectory,'packages/contracts/places.schema.json')));
const categories=new Set(contract.properties.properties.properties.category.enum);

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
      requireValue(f.geometry.type === 'Point' && f.geometry.coordinates.length === 2, `${name}: places must be points`);
      requireValue(typeof p.id === 'string' && p.id.length > 0 && !ids.has(p.id), `${name}: missing or duplicate place id`);
      ids.add(p.id);
      requireValue(typeof p.name === 'string' && p.name.trim().length > 0, `${name}: missing place name`);
      requireValue(categories.has(p.category), `${name}: unknown category`);
    }
  }
  return data.features.length;
}
export function validateStops(data) {
  const count = validateCollection(data, {label: 'transport stops', geometryTypes: ['Point']});
  const ids = new Set();
  for (const f of data.features) {
    const {stopId, name} = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    requireValue(typeof stopId === 'string' && stopId.length > 0 && !ids.has(stopId) && f.id === stopId, 'Missing or duplicate stop ID');
    requireValue(typeof name === 'string' && name.trim().length > 0, 'Missing stop name');
    requireValue(f.geometry.coordinates.length === 2 && lon >= 17.8 && lon <= 21 && lat >= 41.3 && lat <= 44.1, 'Stop outside Montenegro');
    ids.add(stopId);
  }
  requireValue(count > 0, 'Empty transport stop snapshot');
  return count;
}
export function validateTransitNetwork(data) {
  requireValue(data?.version === 1 && data.stops && typeof data.stops === 'object' && Array.isArray(data.patterns) && data.patterns.length > 0 && data.patterns.length <= 500, 'Invalid transit network');
  requireValue(Number.isFinite(Date.parse(data.retrievedAt)) && typeof data.source === 'string' && Object.keys(data.stops).length > 0 && Object.keys(data.stops).length <= 5000, 'Transit snapshot metadata missing');
  for (const stop of Object.values(data.stops)) {
    position(stop.coordinates, 'transit stop');
    const [lon, lat] = stop.coordinates;
    requireValue(stop.coordinates.length === 2 && lon >= 17.8 && lon <= 21 && lat >= 41.3 && lat <= 44.1 && typeof stop.name === 'string' && stop.name.trim().length > 0, 'Invalid transit stop');
  }
  for (const p of data.patterns) {
    requireValue(typeof p.route === 'string' && p.route.length > 0 && p.route.length <= 32 && typeof p.name === 'string' && typeof p.headsign === 'string' && Array.isArray(p.stops) && p.stops.length >= 2 && p.stops.length <= 300 && Array.isArray(p.offsets) && p.stops.length === p.offsets.length, 'Invalid transit pattern');
    requireValue(p.stops.every(id => typeof id === 'string' && Object.hasOwn(data.stops, id)), 'Pattern references missing stop');
    requireValue(p.offsets[0] === 0 && p.offsets.every((t, i) => Number.isFinite(t) && t >= 0 && t <= 172800 && (i === 0 || t >= p.offsets[i - 1])), 'Invalid trip offsets');
  }
  return data.patterns.length;
}
function insideRing(point, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function validateBuildingLabels(data, buildings) {
  const count=validateCollection(data,{label:'building labels',geometryTypes:['Point'],requireKind:true});
  const ids=new Set(),footprints=new Set();
  for(const f of data.features) {
    const p=f.properties,index=p.footprintIndex,number=p['addr:housenumber'];
    requireValue(p.kind==='building' && typeof number==='string' && number.trim().length>0 && number.length<=128 && !['','bb','бб','bezbroja','безброја','na','?'].includes(number.toLowerCase().replace(/[\s./_-]/g,'')), 'Missing building house number');
    requireValue(typeof f.id==='string' && /^way\/\d+$/.test(f.id) && p.osm_id===f.id && !ids.has(f.id), 'Invalid or duplicate building source ID');
    requireValue(Number.isInteger(index) && index>=0 && index<buildings.features.length && !footprints.has(index), 'Invalid or duplicate footprint reference');
    requireValue(Array.isArray(p.address_sources) && p.address_sources.length>0 && p.address_sources.every(id=>/^(way|node)\/\d+$/.test(id)), 'Building address source missing');
    const g=buildings.features[index].geometry,point=f.geometry.coordinates;
    requireValue(g.type==='Polygon' && point.length===2 && insideRing(point,g.coordinates[0]) && !g.coordinates.slice(1).some(r=>insideRing(point,r)), 'Building label outside its polygon');
    ids.add(f.id);footprints.add(index);
  }
  requireValue(count>0, 'Empty building address snapshot');
  return count;
}
export function checkData(root = rootDirectory) {
  const buildingBytes=fs.readFileSync(path.join(root,'data/sources/buildings.geojson'));
  const labelBytes=fs.readFileSync(path.join(root,'data/sources/building-labels.geojson'));
  const labelProvenance=JSON.parse(fs.readFileSync(path.join(root,'data/sources/building-labels.provenance.json')));
  const labelCount=validateBuildingLabels(JSON.parse(labelBytes),JSON.parse(buildingBytes));
  requireValue(labelCount===labelProvenance.features && labelBytes.length===labelProvenance.bytes && crypto.createHash('sha256').update(labelBytes).digest('hex')===labelProvenance.sha256 && crypto.createHash('sha256').update(buildingBytes).digest('hex')===labelProvenance.buildings_sha256, 'Building label provenance mismatch');

  const transitBytes = fs.readFileSync(path.join(root, 'data/sources/transit-network.json'));
  const transitProvenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/transit-network.provenance.json')));
  const transit = JSON.parse(transitBytes);
  requireValue(validateTransitNetwork(transit) === transitProvenance.patterns && Object.keys(transit.stops).length === transitProvenance.stops && transitBytes.length === transitProvenance.bytes && crypto.createHash('sha256').update(transitBytes).digest('hex') === transitProvenance.sha256, 'Transit network provenance mismatch');

  const stopBytes = fs.readFileSync(path.join(root, 'data/sources/transport-stops.geojson'));
  const stopProvenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/transport-stops.provenance.json')));
  const stopCount = validateStops(JSON.parse(stopBytes));
  requireValue(stopCount === stopProvenance.features && stopBytes.length === stopProvenance.bytes && crypto.createHash('sha256').update(stopBytes).digest('hex') === stopProvenance.sha256 && Number.isFinite(Date.parse(stopProvenance.retrieved_at)), 'Stop snapshot provenance mismatch');

  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/provenance.json')));
  requireValue(labelProvenance.upstream_snapshot===provenance.upstream_snapshot && labelProvenance.direct_building_addresses+labelProvenance.node_derived_addresses===labelCount, 'Building label source/count metadata mismatch');
  requireValue(Number.isFinite(Date.parse(provenance.upstream_snapshot)) && typeof provenance.coverage === 'string', 'Source timestamp/coverage missing');
  for (const [name, expected] of Object.entries(provenance.layers)) {
    requireValue(/^[\w-]+\.geojson$/.test(name), 'Unsafe provenance layer path');
    const bytes = fs.readFileSync(path.join(root, 'data/sources', name));
    const geometryTypes = name === 'roads.geojson' ? ['LineString', 'MultiLineString'] : name === 'water.geojson' ? ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'] : ['Polygon', 'MultiPolygon'];
    const count = validateCollection(JSON.parse(bytes), {label: name, geometryTypes, requireKind: true});
    requireValue(count === expected.features && bytes.length === expected.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha256,
      `${name}: provenance mismatch. Review the dataset and update data/sources/provenance.json.`);
  }
  requireValue(provenance.places_file === 'data/sources/places.geojson', 'Unexpected places_file');
  const count = validateCollection(JSON.parse(fs.readFileSync(path.join(root, provenance.places_file))), {places: true, label: 'places'});
  requireValue(count === provenance.places_count, 'Place count differs from reviewed provenance');
  const release=JSON.parse(fs.readFileSync(path.join(root,'data/artifacts/release.json')));
  requireValue(/^montenegro-[a-f0-9]{16}\.pmtiles$/.test(release.archive.file), 'Unsafe archive filename');
  const archive=fs.readFileSync(path.join(root,'data/artifacts',release.archive.file));
  requireValue(archive.length===release.archive.bytes && crypto.createHash('sha256').update(archive).digest('hex')===release.archive.sha256, 'Data release archive mismatch');
  requireValue(release.sourceTimestamp===provenance.upstream_snapshot && release.coverage===provenance.coverage, 'Data release metadata differs from provenance');
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Validated geometry, source hashes, and ${checkData()} places. This is structural validation, not GIS topology validation.`);
}
