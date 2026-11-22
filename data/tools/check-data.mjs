import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {entranceBearing} from './building-entrances.mjs';
import {validateSourceEntities} from './entity-identity.mjs';
import {applyVisibility, placesProvenance, serializePlaces} from './apply-place-visibility.mjs';
import {contractPath, contractsDirectoryFrom, readContract} from './contracts.mjs';
const rootDirectory=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nameFields = new Set(['name', 'name:en']);

function requireValue(ok, message) { if (!ok) throw new Error(message); }

function placeRules(contractsDirectory) {
  const placeSchema = readContract(contractsDirectory, 'places.schema.json');
  const visibilityConfig = readContract(contractsDirectory, 'place-visibility.json');
  return {
    categories: new Set(placeSchema.properties.properties.properties.category.enum),
    visibilityLevels: new Set(visibilityConfig.levels.map(entry => entry.level))
  };
}
function landWaterRules(contractsDirectory) {
  const definitions = readContract(contractsDirectory, 'source-land-water.schema.json').$defs;
  const landKinds = new Set(definitions.landKind.enum);
  const waterKinds = new Set(definitions.waterKind.enum);
  const preservedLandKinds = new Set(['country', 'context']);
  const extractedLandKinds = new Set([...landKinds].filter(kind => !preservedLandKinds.has(kind)));
  const derivedWaterKinds = new Set(['ocean']);
  return {
    definitions,
    landKinds,
    waterKinds,
    extractedLandKinds,
    requiredOsmTagKinds: new Set([
      ...extractedLandKinds,
      ...[...waterKinds].filter(kind => !derivedWaterKinds.has(kind))
    ]),
    osmTagPattern: new RegExp(definitions.osmTag.pattern)
  };
}
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
// Shoelace area is positive for counterclockwise rings in longitude/latitude axes.
function signedRingArea(ring) {
  let twiceArea = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [longitude, latitude] = ring[index];
    const [nextLongitude, nextLatitude] = ring[index + 1];
    twiceArea += longitude * nextLatitude - nextLongitude * latitude;
  }
  return twiceArea / 2;
}

function validateRingWinding(geometryValue, label) {
  const polygons = geometryValue.type === 'Polygon'
    ? [geometryValue.coordinates]
    : geometryValue.coordinates;
  polygons.forEach((rings, index) => {
    requireValue(signedRingArea(rings[0]) > 0, `${label}: polygon ${index} exterior must be counterclockwise`);
    rings.slice(1).forEach((ring, holeIndex) => {
      requireValue(signedRingArea(ring) < 0, `${label}: polygon ${index} hole ${holeIndex} must be clockwise`);
    });
  });
}

function validateLandWaterProperties(properties, label, rules, expectedOsmTagKinds) {
  const definitions = rules.definitions;
  const {osmTag, name, 'name:en': englishName, destination, tunnel, intermittent} = properties;
  if ((expectedOsmTagKinds ?? rules.requiredOsmTagKinds)?.has(properties.kind)) {
    requireValue(typeof osmTag === 'string' && osmTag.length > 0, `${label}: missing osmTag`);
  }
  if (osmTag !== undefined) {
    const validTag = typeof osmTag === 'string'
      && osmTag.length <= definitions.osmTag.maxLength
      && rules.osmTagPattern.test(osmTag);
    requireValue(validTag, `${label}: invalid osmTag`);
  }
  for (const [field, value] of [['name', name], ['name:en', englishName], ['tunnel', tunnel], ['intermittent', intermittent]]) {
    if (value === undefined) continue;
    const definition = field === 'tunnel' || field === 'intermittent' ? definitions[field] : definitions.name;
    const withinMaxLength = typeof value === 'string' && value.length <= definition.maxLength;
    requireValue(withinMaxLength, `${label}: invalid ${field}`);
    if (nameFields.has(field)) requireValue(value.trim().length > 0, `${label}: blank ${field}`);
  }
  if (destination !== undefined) requireValue(destination === true, `${label}: destination must be true when present`);
}

export function validateCollection(data, {
  places = false,
  label = 'GeoJSON',
  geometryTypes,
  requireKind = false,
  requireAdopted = false,
  contractsDirectory,
  allowedKinds,
  ringKinds,
  requireRfc7946Rings = false,
  landWater = false,
  requiredOsmTagKinds,
  landWaterContractRules: suppliedLandWaterRules
} = {}) {
  requireValue(data?.type === 'FeatureCollection' && Array.isArray(data.features), `${label}: expected FeatureCollection`);
  if (requireAdopted) requireValue(data.entitySchemaVersion === 1, `${label}: requires entitySchemaVersion 1`);
  validateSourceEntities(data, {label, contractsDirectory});
  const rules = places ? placeRules(contractsDirectory) : null;
  const landWaterContractRules = landWater ? suppliedLandWaterRules ?? landWaterRules(contractsDirectory) : null;
  const ids = new Set();
  for (const [i, f] of data.features.entries()) {
    const name = `${label} feature ${i}`;
    requireValue(f.type === 'Feature' && f.properties && typeof f.properties === 'object', `${name}: invalid feature`);
    geometry(f.geometry, name);
    if (geometryTypes) requireValue(geometryTypes.includes(f.geometry.type), `${name}: geometry type violates layer contract`);
    if (requireKind) requireValue(typeof f.properties.kind === 'string' && f.properties.kind.length > 0, `${name}: missing kind`);
    if (allowedKinds) requireValue(allowedKinds.has(f.properties.kind), `${name}: unsupported kind ${f.properties.kind}`);
    if (landWater) validateLandWaterProperties(f.properties, name, landWaterContractRules, requiredOsmTagKinds);
    const requiresRings = requireRfc7946Rings && (!ringKinds || ringKinds.has(f.properties.kind));
    if (requiresRings && ['Polygon', 'MultiPolygon'].includes(f.geometry.type)) validateRingWinding(f.geometry, name);
    if (places) {
      const p = f.properties;
      requireValue(f.geometry.type === 'Point' && f.geometry.coordinates.length === 2, `${name}: places must be points`);
      requireValue(typeof p.id === 'string' && p.id.length > 0 && !ids.has(p.id), `${name}: missing or duplicate place id`);
      ids.add(p.id);
      requireValue(typeof p.name === 'string' && p.name.trim().length > 0, `${name}: missing place name`);
      requireValue(rules.categories.has(p.category), `${name}: unknown category`);
      requireValue(rules.visibilityLevels.has(p.visibilityLevel), `${name}: missing or unsupported visibilityLevel`);
    }
  }
  return data.features.length;
}
export function validateStops(data, {requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {label: 'transport stops', geometryTypes: ['Point'], requireAdopted, contractsDirectory});
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
function sourceRules(contractsDirectory) {
  const editingRules = readContract(contractsDirectory, 'editor-layers.json').layers;
  return {
    houseNumber: editingRules['building-labels.geojson'].properties['addr:housenumber'],
    building: editingRules['buildings.geojson'].properties,
    entrance: editingRules['building-entrances.geojson'].properties
  };
}
function noNumber(value, rule) {
  const ignoredCharacters = new RegExp(rule.ignoredCharactersPattern, 'g');
  return rule.forbiddenValues.includes(value.toLowerCase().replace(ignoredCharacters, ''));
}

function addressText(value) {
  const maximumTextLength = 128;
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximumTextLength;
}

// Match the extractor's case- and whitespace-only street fold; no transliteration or punctuation removal.
function normalizeStreetName(value) {
  return value.trim().split(/\s+/u).join(' ').toLowerCase();
}

function roadNameGroups(roads) {
  const groups = new Map();
  for (const feature of roads.features) {
    const name = feature.properties.name;
    const hasName = typeof name === 'string' && name.trim().length > 0;
    if (!hasName) {
      continue;
    }
    const key = normalizeStreetName(name);
    if (!groups.has(key)) {
      groups.set(key, new Set());
    }
    groups.get(key).add(feature.properties.entityId);
  }
  return groups;
}

export function validateBuildingDetailCounts(counts, details) {
  const expectedNames = Object.keys(details)
    .filter(name => name !== 'entrancesUnjoined')
    .sort();
  const actualNames = Object.keys(counts).sort();
  requireValue(
    JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    'building_details: count fields differ from the reviewed provenance'
  );
  for (const [name, count] of Object.entries(counts)) {
    requireValue(
      details[name] === count,
      `building_details.${name}: count differs from the reviewed provenance`
    );
  }
}

// Only unambiguous, sourced entrance points on a footprint wall may be published.
function validateEntrances(properties, polygon, sourceIDs, houseNumber) {
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
      requireValue(addressText(value) && (field !== 'number' || !noNumber(value, houseNumber)), `Invalid entrance ${field}`);
    }
    const isBoundary = polygon.coordinates.some(ring => onRing(entrance.coordinates, ring));
    requireValue(isBoundary, 'Entrance must lie on a building wall');
  }
}

// Labels retain reviewed source identities and interior anchors; entrance points must be on a wall.
export function validateBuildingLabels(data, buildings, {requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {
    label: 'building labels',
    geometryTypes: ['Point'],
    requireKind: true,
    requireAdopted,
    contractsDirectory
  });
  const houseNumber = sourceRules(contractsDirectory).houseNumber;
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
      requireValue(addressText(value) && (!isNumber || !noNumber(value, houseNumber)), `Invalid building ${field}`);
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
    validateEntrances(properties, polygon, sourceIDs, houseNumber);
    sourceIDs.add(feature.id);
    footprints.add(footprintIndex);
  }
  requireValue(count > 0, 'Empty building address snapshot');
  return count;
}
const copiedBuildingTagNames = ['building', 'building:levels', 'building:material', 'start_date', 'roof:levels', 'name'];
const copiedEntranceFieldNames = ['ref', 'level', 'wheelchair', 'door'];

function incrementCount(counts, name, amount = 1) {
  counts[name] = (counts[name] ?? 0) + amount;
}

// Text copied from OSM is bounded by the same editor rule that a reviewer would use.
function copiedText(properties, name, rules, label) {
  const value = properties[name];
  if (value === undefined) {
    return false;
  }
  const rule = rules[name];
  const isAllowed = addressText(value) && (!rule || value.length <= rule.maxLength);
  requireValue(isAllowed, `${label}: invalid ${name}`);
  return true;
}

function validateBuildingNumberRules(properties, rules) {
  const hasNumber = copiedText(properties, 'addr:housenumber', rules.building, 'building');
  const hasNoNumber = properties.nohousenumber !== undefined;
  requireValue(!(hasNumber && hasNoNumber), 'building: house number and no-number flag are exclusive');
  if (hasNoNumber) {
    requireValue(properties.nohousenumber === 'yes', 'building: invalid no-number flag');
  }
  if (hasNumber) {
    requireValue(!noNumber(properties['addr:housenumber'], rules.houseNumber), 'building: no-number placeholder must not be a house number');
  }
  return {hasNumber, hasNoNumber};
}

function countCopiedBuildingTags(properties, counts, rules) {
  for (const name of copiedBuildingTagNames) {
    const isPresent = copiedText(properties, name, rules.building, 'building');
    incrementCount(counts, name, Number(isPresent));
  }
}

function wayNumber(entityId) {
  return Number.parseInt(String(entityId).split('/')[1], 10);
}

function validateBuildingStreetJoin(properties, streetGroups, counts, rules) {
  const hasStreet = copiedText(properties, 'addr:street', rules.building, 'building');
  const matchingRoads = hasStreet
    ? streetGroups.get(normalizeStreetName(properties['addr:street'])) ?? new Set()
    : new Set();
  incrementCount(counts, 'addr:street', Number(hasStreet));
  const streetEntityId = properties['addr:streetEntityId'];
  const streetEntityIds = properties['addr:streetEntityIds'];
  if (streetEntityId !== undefined || streetEntityIds !== undefined) {
    requireValue(hasStreet, 'building: street join without a street name');
    // Published roads carry no OSM node IDs, so the source must declare its whole connected group.
    const expectedIds = [...matchingRoads].sort((first, second) => wayNumber(first) - wayNumber(second));
    const isWholeGroup = Array.isArray(streetEntityIds) &&
      streetEntityIds.length > 0 &&
      streetEntityIds.length === expectedIds.length &&
      streetEntityIds.every((entityId, index) => entityId === expectedIds[index]) &&
      streetEntityId === expectedIds[0];
    requireValue(isWholeGroup, 'building: street join must list every published road with the same name');
    incrementCount(counts, 'addr:streetEntityId');
    incrementCount(counts, 'addr:streetEntityIds');
    return;
  }
  if (hasStreet) {
    requireValue(matchingRoads.size !== 1, 'building: a street name with one published road must be joined');
    incrementCount(counts, 'addr:streetUnjoined');
  }
}

function validateEntranceProperties(properties, buildingIDs, counts, rules) {
  requireValue(addressText(properties.entrance), 'entrance: invalid entrance type');
  requireValue(buildingIDs.has(properties.buildingEntityId), 'entrance: unknown buildingEntityId');
  for (const name of copiedEntranceFieldNames) {
    const isPresent = copiedText(properties, name, rules.entrance, 'entrance');
    incrementCount(counts, `entrance:${name}`, Number(isPresent));
  }
  for (const name of Object.keys(properties)) {
    if (!name.startsWith('addr:')) {
      continue;
    }
    copiedText(properties, name, rules.entrance, 'entrance');
    incrementCount(counts, `entrance:${name}`);
  }
  const houseNumber = properties['addr:housenumber'];
  const hasNoNumber = properties.nohousenumber !== undefined;
  if (hasNoNumber) {
    requireValue(properties.nohousenumber === 'yes', 'entrance: invalid no-number flag');
  }
  if (houseNumber !== undefined) {
    requireValue(!noNumber(houseNumber, rules.houseNumber), 'entrance: no-number placeholder must not be a house number');
    requireValue(!hasNoNumber, 'entrance: house number and no-number flag are exclusive');
  }
  incrementCount(counts, 'entrance:nohousenumber', Number(hasNoNumber));
  incrementCount(counts, `entranceKind:${properties.entrance}`);
}

function countPlacesByBuildingJoin(places, buildingIDs, counts) {
  // The buildings group does not refresh places, so a places snapshot from another Feature has no joins to count.
  const joinedPlaces = places.features.filter(
    feature => feature.properties.buildingEntityId !== undefined
  );
  if (joinedPlaces.length === 0) return;
  for (const feature of joinedPlaces) {
    requireValue(buildingIDs.has(feature.properties.buildingEntityId), 'place: unknown buildingEntityId');
  }
  counts.placesInsideBuildings = joinedPlaces.length;
  counts.placesOutsideBuildings = places.features.length - joinedPlaces.length;
}

// New source files join by upstream identity, never by display name or array position.
export function validateBuildingSources(buildings, roads, entrances, places, {contractsDirectory} = {}) {
  validateCollection(buildings, {label: 'buildings.geojson', geometryTypes: ['Polygon', 'MultiPolygon'], requireKind: true, contractsDirectory});
  validateCollection(roads, {label: 'roads.geojson', geometryTypes: ['LineString', 'MultiLineString'], requireKind: true, contractsDirectory});
  const entranceCount = validateCollection(entrances, {label: 'building-entrances.geojson', geometryTypes: ['Point'], requireKind: true, contractsDirectory});
  const buildingIDs = new Set(buildings.features.map(feature => feature.properties.entityId));
  const streetGroups = roadNameGroups(roads);
  const rules = sourceRules(contractsDirectory);
  const counts = {};
  for (const feature of buildings.features) {
    const properties = feature.properties;
    const {hasNumber, hasNoNumber} = validateBuildingNumberRules(properties, rules);
    countCopiedBuildingTags(properties, counts, rules);
    incrementCount(counts, 'addr:housenumber', Number(hasNumber));
    incrementCount(counts, 'addr:housenumberPresent', Number(hasNumber));
    incrementCount(counts, 'nohousenumber', Number(hasNoNumber));
    validateBuildingStreetJoin(properties, streetGroups, counts, rules);
  }
  for (const feature of entrances.features) {
    validateEntranceProperties(feature.properties, buildingIDs, counts, rules);
  }
  counts.entrances = entranceCount;
  countPlacesByBuildingJoin(places, buildingIDs, counts);
  return counts;
}

export function checkPlaceMetadata(placeBytes, policyBytes, configBytes, provenance, {requireAdopted = false, contractsDirectory} = {}) {
  const places = JSON.parse(placeBytes);
  const count = validateCollection(places, {places: true, label: 'places', requireAdopted, contractsDirectory});
  requireValue(count === provenance.places_count, 'Place count differs from reviewed provenance');
  requireValue(serializePlaces(applyVisibility(places, JSON.parse(policyBytes), JSON.parse(configBytes))) === placeBytes, 'Place visibility levels differ from the reviewed policy. Run data/tools/apply-place-visibility.mjs --contracts-directory packages/contracts.');
  for (const [key, value] of Object.entries(placesProvenance(placeBytes, places, policyBytes, configBytes))) requireValue(provenance[key] === value, `Place provenance mismatch: ${key}. Review the change and update data/sources/provenance.json.`);
  return count;
}
function sourceGeometryTypes(filename) {
  if (filename === 'roads.geojson') return ['LineString', 'MultiLineString'];
  if (filename === 'water.geojson') return ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'];
  if (filename === 'building-entrances.geojson') return ['Point'];
  if (filename === 'road-nodes.geojson') return ['Point'];
  return ['Polygon', 'MultiPolygon'];
}
// Allowed highway values for road network nodes.
const ROAD_NODE_KINDS = new Set([
  'traffic_signals', 'crossing', 'stop', 'give_way',
  'mini_roundabout', 'turning_circle',
]);
// Allowed restriction values from OSM turn restriction relations.
// Base values documented by OSM; transport-specific restriction:* tags are not
// extracted as the restriction value.
const RESTRICTION_VALUES = new Set([
  'no_left_turn', 'no_right_turn', 'no_u_turn', 'no_straight_on',
  'only_left_turn', 'only_right_turn', 'only_u_turn', 'only_straight_on',
  'no_entry', 'no_exit',
]);
// Allowed pathClass values.
const PATH_CLASS_VALUES = new Set(['main', 'trail']);

// Road nodes: points with OSM identity and a recognised highway kind.
export function validateRoadNodes(data, {contractsDirectory} = {}) {
  const count = validateCollection(data, {label: 'road-nodes.geojson', geometryTypes: ['Point'], contractsDirectory});
  const seenEntityIds = new Set();
  for (const [index, feature] of data.features.entries()) {
    const name = `road-nodes.geojson feature ${index}`;
    const properties = feature.properties;
    requireValue(ROAD_NODE_KINDS.has(properties.kind), `${name}: unknown road node kind: ${properties.kind}`);
    requireValue(/^node\/\d+$/.test(properties.entityId), `${name}: invalid OSM node identity`);
    requireValue(!seenEntityIds.has(properties.entityId), `${name}: duplicate entityId`);
    seenEntityIds.add(properties.entityId);
  }
  requireValue(count > 0, 'Empty road nodes snapshot');
  return count;
}

function roadWayIds(roads) {
  const wayIds = new Set();
  for (const feature of roads.features) {
    const match = feature.properties.entityId?.match(/^way\/(\d+)$/);
    if (match) wayIds.add(Number(match[1]));
  }
  return wayIds;
}

function roadEndNodeIds(roads) {
  const endNodeIds = new Set();
  for (const feature of roads.features) {
    const properties = feature.properties;
    if (properties.startNode !== undefined) endNodeIds.add(properties.startNode);
    if (properties.endNode !== undefined) endNodeIds.add(properties.endNode);
  }
  return endNodeIds;
}

function roadNodePointIds(roadNodes) {
  const nodeIds = new Set();
  for (const feature of roadNodes.features) {
    const match = feature.properties.entityId?.match(/^node\/(\d+)$/);
    if (match) nodeIds.add(Number(match[1]));
  }
  return nodeIds;
}

// Turn restrictions: structured JSON with OSM identity and from/to/via refs.
export function validateTurnRestrictions(data, roads, roadNodes) {
  requireValue(data?.entitySchemaVersion === 1, 'turn-restrictions.json: missing entitySchemaVersion');
  requireValue(Array.isArray(data.restrictions), 'turn-restrictions.json: missing restrictions array');
  const wayIds = roadWayIds(roads);
  const endNodeIds = roadEndNodeIds(roads);
  const nodeIds = roadNodePointIds(roadNodes);
  const allowedViaNodes = new Set([...nodeIds, ...endNodeIds]);

  for (const [index, restriction] of data.restrictions.entries()) {
    const label = `restriction ${index} (${restriction.entityId})`;
    requireValue(/^relation\/\d+$/.test(restriction.entityId), `${label}: invalid entityId`);
    requireValue(
      Number.isSafeInteger(restriction.entityVersion) && restriction.entityVersion >= 1,
      `${label}: invalid entityVersion`
    );
    requireValue(
      RESTRICTION_VALUES.has(restriction.restriction),
      `${label}: unknown restriction value: ${restriction.restriction}`
    );
    requireValue(Number.isSafeInteger(restriction.from), `${label}: invalid from way ID`);
    requireValue(Number.isSafeInteger(restriction.to), `${label}: invalid to way ID`);
    requireValue(
      wayIds.has(restriction.from),
      `${label}: from way ${restriction.from} not found in roads.geojson`
    );
    requireValue(
      wayIds.has(restriction.to),
      `${label}: to way ${restriction.to} not found in roads.geojson`
    );
    if (Array.isArray(restriction.viaNodes)) {
      for (const viaNodeId of restriction.viaNodes) {
        requireValue(
          allowedViaNodes.has(viaNodeId),
          `${label}: via node ${viaNodeId} not found in road-nodes.geojson or road end nodes`
        );
      }
    }
    if (Array.isArray(restriction.viaWays)) {
      for (const viaWayId of restriction.viaWays) {
        requireValue(
          wayIds.has(viaWayId),
          `${label}: via way ${viaWayId} not found in roads.geojson`
        );
      }
    }
  }
  return {count: data.restrictions.length};
}

// Validate road features: pathClass, end nodes and levels.
export function validateRoads(data, {contractsDirectory} = {}) {
  const count = validateCollection(data, {label: 'roads.geojson', geometryTypes: ['LineString', 'MultiLineString'], contractsDirectory});
  for (const [index, feature] of data.features.entries()) {
    const name = `roads.geojson feature ${index}`;
    const properties = feature.properties;
    if (properties.pathClass !== undefined) {
      requireValue(PATH_CLASS_VALUES.has(properties.pathClass), `${name}: invalid pathClass: ${properties.pathClass}`);
    }
    const endNodeFields = [
      ['startNode', 'startLevel'],
      ['endNode', 'endLevel'],
    ];
    for (const [nodeField, levelField] of endNodeFields) {
      const nodeValue = properties[nodeField];
      const levelValue = properties[levelField];
      if (nodeValue !== undefined) {
        requireValue(Number.isSafeInteger(nodeValue), `${name}: ${nodeField} must be an integer`);
      }
      if (levelValue !== undefined) {
        requireValue(Number.isInteger(levelValue), `${name}: ${levelField} must be an integer`);
      }
      const hasNode = nodeValue !== undefined;
      const hasLevel = levelValue !== undefined;
      requireValue(hasNode === hasLevel, `${name}: ${nodeField} and ${levelField} must appear together`);
    }
  }
  requireValue(count > 0, 'Empty roads snapshot');
  return count;
}

export function checkData(root = rootDirectory, {contractsDirectory} = {}) {
  const buildingBytes=fs.readFileSync(path.join(root,'data/sources/buildings.geojson'));
  const labelBytes=fs.readFileSync(path.join(root,'data/sources/building-labels.geojson'));
  const labelProvenance=JSON.parse(fs.readFileSync(path.join(root,'data/sources/building-labels.provenance.json')));
  const buildings = JSON.parse(buildingBytes);
  requireValue(buildings.entitySchemaVersion === 1, 'buildings.geojson: requires entitySchemaVersion 1');
  validateSourceEntities(buildings, {label: 'buildings.geojson', contractsDirectory});
  const labelCount=validateBuildingLabels(JSON.parse(labelBytes),buildings,{requireAdopted: true, contractsDirectory});
  requireValue(labelCount===labelProvenance.features && labelBytes.length===labelProvenance.bytes && crypto.createHash('sha256').update(labelBytes).digest('hex')===labelProvenance.sha256 && crypto.createHash('sha256').update(buildingBytes).digest('hex')===labelProvenance.buildings_sha256, 'Building label provenance mismatch');

  const transitBytes = fs.readFileSync(path.join(root, 'data/sources/transit-network.json'));
  const transitProvenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/transit-network.provenance.json')));
  const transit = JSON.parse(transitBytes);
  requireValue(validateTransitNetwork(transit) === transitProvenance.patterns && Object.keys(transit.stops).length === transitProvenance.stops && transitBytes.length === transitProvenance.bytes && crypto.createHash('sha256').update(transitBytes).digest('hex') === transitProvenance.sha256, 'Transit network provenance mismatch');

  const stopBytes = fs.readFileSync(path.join(root, 'data/sources/transport-stops.geojson'));
  const stopProvenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/transport-stops.provenance.json')));
  const stopCount = validateStops(JSON.parse(stopBytes), {requireAdopted: true, contractsDirectory});
  requireValue(stopCount === stopProvenance.features && stopBytes.length === stopProvenance.bytes && crypto.createHash('sha256').update(stopBytes).digest('hex') === stopProvenance.sha256 && Number.isFinite(Date.parse(stopProvenance.retrieved_at)), 'Stop snapshot provenance mismatch');

  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/provenance.json')));
  const landWaterContractRules = landWaterRules(contractsDirectory);
  requireValue(labelProvenance.upstream_snapshot===provenance.upstream_snapshot && labelProvenance.direct_building_addresses+labelProvenance.node_derived_addresses===labelCount, 'Building label source/count metadata mismatch');
  requireValue(Number.isFinite(Date.parse(provenance.upstream_snapshot)) && typeof provenance.coverage === 'string', 'Source timestamp/coverage missing');
  for (const [name, expected] of Object.entries(provenance.layers)) {
    requireValue(/^[\w-]+(\.geojson|\.json)$/.test(name), 'Unsafe provenance layer path');
    const bytes = fs.readFileSync(path.join(root, 'data/sources', name));
    if (name.endsWith('.geojson')) {
      const isLand = name === 'land.geojson';
      const isWater = name === 'water.geojson';
      const allowedKinds = isLand ? landWaterContractRules.landKinds : isWater ? landWaterContractRules.waterKinds : undefined;
      const geometryTypes = sourceGeometryTypes(name);
      const count = validateCollection(JSON.parse(bytes), {
        label: name,
        geometryTypes,
        requireKind: true,
        requireAdopted: true,
        contractsDirectory,
        allowedKinds,
        ringKinds: isLand ? landWaterContractRules.extractedLandKinds : undefined,
        requireRfc7946Rings: Boolean(allowedKinds),
        landWater: Boolean(allowedKinds),
        requiredOsmTagKinds: landWaterContractRules.requiredOsmTagKinds,
        landWaterContractRules
      });
      requireValue(count === expected.features && bytes.length === expected.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha256,
        `${name}: provenance mismatch. Review the dataset and update data/sources/provenance.json.`);
    } else {
      requireValue(bytes.length === expected.bytes && crypto.createHash('sha256').update(bytes).digest('hex') === expected.sha256,
        `${name}: provenance mismatch. Review the dataset and update data/sources/provenance.json.`);
    }
  }
  // Validate roads specifically (pathClass, graph nodes, levels)
  const roadsPath = path.join(root, 'data/sources/roads.geojson');
  if (fs.existsSync(roadsPath)) {
    const roadsData = JSON.parse(fs.readFileSync(roadsPath));
    validateRoads(roadsData, {contractsDirectory});
    // Validate road nodes if present
    const roadNodesPath = path.join(root, 'data/sources/road-nodes.geojson');
    if (fs.existsSync(roadNodesPath)) {
      const roadNodesData = JSON.parse(fs.readFileSync(roadNodesPath));
      validateRoadNodes(roadNodesData, {contractsDirectory});
      // Validate turn restrictions against roads and road nodes
      const restrictionsPath = path.join(root, 'data/sources/turn-restrictions.json');
      if (fs.existsSync(restrictionsPath)) {
        const restrictionsData = JSON.parse(fs.readFileSync(restrictionsPath));
        validateTurnRestrictions(restrictionsData, roadsData, roadNodesData);
      }
    }
  }
  validateBuildingSources(
    buildings,
    JSON.parse(fs.readFileSync(path.join(root,'data/sources/roads.geojson'))),
    JSON.parse(fs.readFileSync(path.join(root,'data/sources/building-entrances.geojson'))),
    JSON.parse(fs.readFileSync(path.join(root,'data/sources/places.geojson'))),
    {contractsDirectory}
  );
  requireValue(provenance.places_file === 'data/sources/places.geojson', 'Unexpected places_file');
  const count = checkPlaceMetadata(
    fs.readFileSync(path.join(root, provenance.places_file), 'utf8'),
    fs.readFileSync(path.join(root, 'data/sources/place-visibility-policy.json'), 'utf8'),
    fs.readFileSync(contractPath(contractsDirectory, 'place-visibility.json'), 'utf8'),
    provenance,
    {requireAdopted: true, contractsDirectory}
  );
  const release=JSON.parse(fs.readFileSync(path.join(root,'data/artifacts/release.json')));
  requireValue(/^montenegro-[a-f0-9]{16}\.pmtiles$/.test(release.archive.file), 'Unsafe archive filename');
  const archive=fs.readFileSync(path.join(root,'data/artifacts',release.archive.file));
  requireValue(archive.length===release.archive.bytes && crypto.createHash('sha256').update(archive).digest('hex')===release.archive.sha256, 'Data release archive mismatch');
  requireValue(release.sourceTimestamp===provenance.upstream_snapshot && release.coverage===provenance.coverage, 'Data release metadata differs from provenance');
  return count;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contractsDirectory = contractsDirectoryFrom(process.argv.slice(2), 'check-data.mjs');
  console.log(`Validated geometry, source hashes, and ${checkData(rootDirectory, {contractsDirectory})} places. This is structural validation, not GIS topology validation.`);
}
