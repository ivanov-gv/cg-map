import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {entranceBearing} from './building-entrances.mjs';
import {validateSourceEntities} from './entity-identity.mjs';
import {applyVisibility, placesProvenance, serializePlaces} from './apply-place-visibility.mjs';
const rootDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract=JSON.parse(fs.readFileSync(path.join(rootDirectory,'packages/contracts/places.schema.json')));
const categories=new Set(contract.properties.properties.properties.category.enum);
const visibilityLevels=new Set(JSON.parse(fs.readFileSync(path.join(rootDirectory,'packages/contracts/place-visibility.json'))).levels.map(entry=>entry.level));

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
  validateSourceEntities(data, {label});
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
      requireValue(visibilityLevels.has(p.visibilityLevel), `${name}: missing or unsupported visibilityLevel`);
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
// Footprints are rounded to six decimals; boundary doors may differ by that precision.
function onRing(point, ring) {
  const coordinateToleranceDegrees = 0.000001;
  return ring.slice(1).some((end, segmentIndex) => {
    const start = ring[segmentIndex];
    const longitudeDelta = end[0] - start[0];
    const latitudeDelta = end[1] - start[1];
    const squaredLength = longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
    const projection = squaredLength ? ((point[0] - start[0]) * longitudeDelta + (point[1] - start[1]) * latitudeDelta) / squaredLength : 0;
    const fraction = Math.max(0, Math.min(1, projection));
    const distanceDegrees = Math.hypot(point[0] - start[0] - fraction * longitudeDelta, point[1] - start[1] - fraction * latitudeDelta);
    return distanceDegrees <= coordinateToleranceDegrees;
  });
}

// A placeholder such as "b.b." records a missing number, never a literal identifier. The list is shared with the editor
// through the contract.
const editingRules = JSON.parse(fs.readFileSync(path.join(rootDirectory, 'packages/contracts/editor-layers.json')));
const houseNumberRule = editingRules.layers['building-labels.geojson'].properties['addr:housenumber'];
function noNumber(value) {
  const ignoredCharacters = new RegExp(houseNumberRule.ignoredCharactersPattern, 'g');
  return houseNumberRule.forbiddenValues.includes(value.toLowerCase().replace(ignoredCharacters, ''));
}

function addressText(value) {
  const maximumTextLength = 128;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumTextLength;
}

// Only unambiguous, sourced entrance points on a footprint wall may be published.
function validateEntrances(properties, polygon, sourceIDs) {
  if (properties.entrances === undefined) return;
  const maximumEntrances = 100;
  requireValue(Array.isArray(properties.entrances) && properties.entrances.length <= maximumEntrances, 'Invalid building entrances');
  for (const entrance of properties.entrances) {
    const hasUniqueIdentity = entrance && typeof entrance.id === 'string' && /^node\/\d+$/.test(entrance.id) && !sourceIDs.has(entrance.id);
    requireValue(hasUniqueIdentity, 'Invalid or duplicate entrance ID');
    sourceIDs.add(entrance.id);
    requireValue(properties.address_sources.includes(entrance.id), 'Entrance source missing from address_sources');
    position(entrance.coordinates, 'entrance');
    requireValue(entrance.coordinates.length === 2, 'Invalid entrance coordinates');
    const hasBearing = Number.isFinite(entrance.bearing) && entrance.bearing >= 0 && entrance.bearing < 360;
    requireValue(hasBearing, 'Invalid entrance bearing');
    const expectedBearing = entranceBearing(entrance.coordinates, polygon);
    const bearingDifference = Math.abs((entrance.bearing - expectedBearing + 540) % 360 - 180);
    const bearingToleranceDegrees = 0.1;
    requireValue(bearingDifference <= bearingToleranceDegrees, 'Entrance bearing must point inward perpendicular to its nearest wall');
    for (const field of ['number', 'ref', 'lamela', 'street']) {
      const value = entrance[field];
      if (value === undefined) continue;
      requireValue(addressText(value) && (field !== 'number' || !noNumber(value)), `Invalid entrance ${field}`);
    }
    const isBoundary = polygon.coordinates.some(ring => onRing(entrance.coordinates, ring));
    requireValue(isBoundary, 'Entrance must lie on a building wall');
  }
}

// Labels retain reviewed source identities and interior anchors; entrance points must be on a wall.
export function validateBuildingLabels(data, buildings) {
  const count = validateCollection(data, {label: 'building labels', geometryTypes: ['Point'], requireKind: true});
  const sourceIDs = new Set();
  const footprints = new Set();
  for (const feature of data.features) {
    const properties = feature.properties;
    const footprintIndex = properties.footprintIndex;
    const hasNumber = properties['addr:housenumber'] !== undefined || properties.building_number !== undefined;
    const hasEntrances = Array.isArray(properties.entrances) && properties.entrances.length > 0;
    requireValue(properties.kind === 'building' && (hasNumber || hasEntrances), 'Missing building address or entrances');
    for (const field of ['addr:housenumber', 'building_number', 'lamela', 'addr:street']) {
      const value = properties[field];
      if (value === undefined) continue;
      const isNumber = ['addr:housenumber', 'building_number'].includes(field);
      requireValue(addressText(value) && (!isNumber || !noNumber(value)), `Invalid building ${field}`);
    }
    const hasUniqueSource = typeof feature.id === 'string' && /^way\/\d+$/.test(feature.id) && properties.osm_id === feature.id && !sourceIDs.has(feature.id);
    requireValue(hasUniqueSource, 'Invalid or duplicate building source ID');
    const hasUniqueFootprint = Number.isInteger(footprintIndex) && footprintIndex >= 0 && footprintIndex < buildings.features.length && !footprints.has(footprintIndex);
    requireValue(hasUniqueFootprint, 'Invalid or duplicate footprint reference');
    const addressSources = properties.address_sources;
    const hasSources = Array.isArray(addressSources) && addressSources.length > 0 && addressSources.every(identifier => /^(way|node)\/\d+$/.test(identifier));
    requireValue(hasSources, 'Building address source missing');
    const polygon = buildings.features[footprintIndex].geometry;
    const anchor = feature.geometry.coordinates;
    const isInterior = polygon.type === 'Polygon' && anchor.length === 2 && insideRing(anchor, polygon.coordinates[0]);
    const isCourtyard = polygon.coordinates.slice(1).some(ring => insideRing(anchor, ring));
    requireValue(isInterior && !isCourtyard, 'Building label outside its polygon');
    validateEntrances(properties, polygon, sourceIDs);
    sourceIDs.add(feature.id);
    footprints.add(footprintIndex);
  }
  requireValue(count > 0, 'Empty building address snapshot');
  return count;
}
export function checkPlaceMetadata(placeBytes, policyBytes, configBytes, provenance) {
  const places = JSON.parse(placeBytes);
  const count = validateCollection(places, {places: true, label: 'places'});
  requireValue(count === provenance.places_count, 'Place count differs from reviewed provenance');
  requireValue(serializePlaces(applyVisibility(places, JSON.parse(policyBytes), JSON.parse(configBytes))) === placeBytes, 'Place visibility levels differ from the reviewed policy. Run data/tools/apply-place-visibility.mjs.');
  for (const [key, value] of Object.entries(placesProvenance(placeBytes, places, policyBytes, configBytes))) requireValue(provenance[key] === value, `Place provenance mismatch: ${key}. Review the change and update data/sources/provenance.json.`);
  return count;
}
export function checkData(root = rootDirectory) {
  const buildingBytes=fs.readFileSync(path.join(root,'data/sources/buildings.geojson'));
  const labelBytes=fs.readFileSync(path.join(root,'data/sources/building-labels.geojson'));
  const labelProvenance=JSON.parse(fs.readFileSync(path.join(root,'data/sources/building-labels.provenance.json')));
  const buildings = JSON.parse(buildingBytes);
  validateSourceEntities(buildings, {label: 'buildings.geojson'});
  const labelCount=validateBuildingLabels(JSON.parse(labelBytes),buildings);
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
  const count = checkPlaceMetadata(fs.readFileSync(path.join(root, provenance.places_file), 'utf8'), fs.readFileSync(path.join(root, 'data/sources/place-visibility-policy.json'), 'utf8'), fs.readFileSync(path.join(root, 'packages/contracts/place-visibility.json'), 'utf8'), provenance);
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
