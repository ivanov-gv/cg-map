import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {entranceBearing} from './building-entrances.mjs';
import {validateSourceEntities} from './entity-identity.mjs';
import {applyVisibility, placesProvenance, serializePlaces} from './apply-place-visibility.mjs';
import {contractPath, contractsDirectoryFrom, readContract} from './contracts.mjs';
import {compareRoadIds, isLocalId} from './changeset-derivations.mjs';
import {reversedCanyonRims, reversedClosedContours} from './relief-directions.mjs';
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
  // An area or line drawn in the editor has no OSM tag to copy.
  const isExtracted = !isLocalId(properties.entityId);
  if (isExtracted && (expectedOsmTagKinds ?? rules.requiredOsmTagKinds)?.has(properties.kind)) {
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
const reliefGeometryTypes = {
  'contours.geojson': ['LineString'],
  'summits.geojson': ['Point'],
  'slopes.geojson': ['Polygon'],
  'ridges.geojson': ['LineString'],
  'canyon-rims.geojson': ['LineString']
};
const reliefKinds = {
  'contours.geojson': 'contour',
  'summits.geojson': 'summit',
  'slopes.geojson': 'slope',
  'ridges.geojson': 'ridge',
  'canyon-rims.geojson': 'canyon-rim'
};
const copernicusAttribution = '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';

export function validateRelief(data, {label, contractsDirectory}) {
  const kind = reliefKinds[label];
  const heightMaximum = readContract(contractsDirectory, 'relief.schema.json').$defs.canyonRim.then.properties.height.maximum;
  const count = validateCollection(data, {label, geometryTypes: reliefGeometryTypes[label], requireKind: true, contractsDirectory});
  for (const feature of data.features) {
    const properties = feature.properties;
    requireValue(properties.kind === kind, `${label}: wrong relief kind ${properties.kind}`);
    requireValue(!('source' in properties), `${label}: feature properties must not repeat build provenance`);
    if (kind === 'contour') {
      requireValue(Number.isInteger(properties.elevation) && properties.elevation % 20 === 0, `${label}: elevation is not a 20 m contour`);
      requireValue(typeof properties.index === 'boolean' && properties.index === (properties.elevation % 100 === 0), `${label}: wrong contour index flag`);
      requireValue(!('intervalMetres' in properties) && !('segments' in properties), `${label}: contour build parameters belong in provenance`);
    }
    if (kind === 'summit') {
      requireValue(['peak', 'hill'].includes(properties.natural), `${label}: invalid summit natural kind`);
      for (const key of ['name', 'name:en']) {
        requireValue(!(key in properties) || typeof properties[key] === 'string', `${label}: invalid summit name`);
      }
      requireValue(properties.ele === null || Number.isFinite(properties.ele), `${label}: invalid OSM elevation`);
      // A summit added in the editor was never compared with the terrain model.
      if (isLocalId(properties.entityId)) continue;
      requireValue(Number.isFinite(properties.demElevation) && Number.isFinite(properties.surroundingDemElevation), `${label}: missing DEM elevation`);
      requireValue(['missing', 'mismatch', 'ok'].includes(properties.heightCheck), `${label}: invalid heightCheck`);
      requireValue(properties.heightCheck === 'missing' ? properties.ele === null : properties.ele !== null, `${label}: heightCheck disagrees with OSM elevation`);
      requireValue(Array.isArray(properties.mismatchReasons) && properties.mismatchReasons.every(reason => typeof reason === 'string'), `${label}: invalid mismatch reasons`);
      requireValue(properties.mismatch === (properties.heightCheck === 'mismatch'), `${label}: mismatch flag disagrees with heightCheck`);
      requireValue(properties.mismatch === (properties.mismatchReasons.length > 0), `${label}: mismatch flag disagrees with reasons`);
      requireValue(properties.enclosingContourElevation === null || Number.isFinite(properties.enclosingContourElevation), `${label}: invalid enclosing contour`);
    }
    if (kind === 'slope') {
      requireValue(['sunlit', 'shaded'].includes(properties.aspect), `${label}: invalid aspect class`);
      requireValue(Number.isFinite(properties.areaSquareMetres), `${label}: invalid slope area`);
      requireValue(!('greenKinds' in properties) && !('greenKindsPresentInLand' in properties) && !('minimumAreaSquareMetres' in properties), `${label}: slope build parameters belong in provenance`);
    }
    if (kind === 'ridge') {
      requireValue(typeof properties.sunlitSide === 'string' && typeof properties.shadedSide === 'string', `${label}: incomplete ridge sides`);
      requireValue(!('radiusMetres' in properties), `${label}: ridge build parameters belong in provenance`);
      const hasSummit = 'summit' in properties || 'summitName' in properties;
      requireValue(!hasSummit || ('summit' in properties && 'summitName' in properties), `${label}: summit link and name must appear together`);
      if (hasSummit) {
        requireValue(/^(node|way|relation)\/[1-9][0-9]*$/.test(properties.summit) || isLocalId(properties.summit), `${label}: invalid summit identity`);
        requireValue(typeof properties.summitName === 'string', `${label}: invalid summit name`);
      }
    }
    if (kind === 'canyon-rim') {
      const knownRivers = ['Morača', 'Ribnica'];
      const knownBanks = ['left', 'right'];
      const isDrawn = properties.method === 'editor-drawn';
      if (isDrawn) {
        requireValue(isLocalId(properties.entityId), `${label}: a drawn rim must use local identity`);
        requireValue(!('river' in properties) || knownRivers.includes(properties.river), `${label}: invalid river`);
        requireValue(!('bank' in properties) || knownBanks.includes(properties.bank), `${label}: invalid bank`);
      } else {
        requireValue(knownRivers.includes(properties.river) && knownBanks.includes(properties.bank), `${label}: invalid river bank`);
      }
      requireValue(['osm-cliff', 'dem-canyon-bank', 'editor-drawn'].includes(properties.method), `${label}: invalid rim method`);
      requireValue(!('height' in properties) || (Number.isInteger(properties.height) && properties.height >= 0 && properties.height <= heightMaximum), `${label}: invalid rim height`);
      requireValue(Number.isFinite(properties.lengthMetres) && properties.lengthMetres >= 0, `${label}: invalid rim length`);
      requireValue(!('entityPart' in properties) || (Number.isInteger(properties.entityPart) && properties.entityPart >= 0), `${label}: invalid rim part`);
      for (const key of ['bankDefinition', 'cliffWays', 'cliffLengthMetres', 'demLengthMetres', 'segmentLengthMetres', 'segmentBankRiseMetres', 'minimumBankRiseMetres', 'searchDistanceMetres', 'searchStepMetres']) {
        requireValue(!(key in properties), `${label}: rim build parameters belong in provenance`);
      }
      if (properties.method === 'osm-cliff') {
        requireValue(/^way\/[1-9][0-9]*$/.test(properties.entityId), `${label}: osm cliff rim must keep OSM identity`);
        requireValue(Number.isInteger(properties.entityVersion) && properties.entityVersion > 0, `${label}: osm cliff rim must keep OSM version`);
      }
      if (properties.method === 'dem-canyon-bank') {
        requireValue(/^derived:/.test(properties.entityId), `${label}: dem canyon rim must use derived identity`);
      }
    }
  }
  return count;
}


const settlementRanks = new Set(['capital', 'city', 'town', 'village']);

// Validate LineString borders that name two distinct sides and valid OSM contributors.
export function validateBorderEdges(data, {requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {
    label: 'border edges', geometryTypes: ['LineString'], requireAdopted, contractsDirectory
  });
  for (const feature of data.features) {
    const properties = feature.properties;
    requireValue(properties.kind === 'border', 'Border edge has an unexpected kind');
    requireValue(
      typeof properties.left === 'string' && properties.left.length > 0 &&
      typeof properties.right === 'string' && properties.right.length > 0 &&
      properties.left !== properties.right,
      'Border edge must name two distinct sides'
    );
    requireValue(
      Array.isArray(properties.osmWays) &&
      properties.osmWays.every(way => typeof way === 'string' && /^way\/\d+$/.test(way)),
      'Border edge has invalid OSM way references'
    );
  }
  return count;
}

const MUNICIPALITY_KIND = 'municipality';
const UNASSIGNED_WATER_KIND = 'unassigned-water';
const MUNICIPALITY_CODE_PATTERN = /^ME-\d+$/;
const WATER_IDENTITY_PREFIX = 'derived:unassigned-water-';

function validateAreaEdges(properties, label) {
  const edges = properties.edges;
  const hasEdges = Array.isArray(edges) && edges.length > 0;
  const directionsAreValid = hasEdges && edges.every(edge =>
    typeof edge?.id === 'string' && edge.id.length > 0 &&
    (edge.direction === 1 || edge.direction === -1));
  requireValue(directionsAreValid, `${label}: needs ordered directed edge references`);
}

function validateMunicipalityArea(properties, label) {
  requireValue(properties.kind === MUNICIPALITY_KIND, `${label}: unexpected kind`);
  const code = properties['ISO3166-2'];
  requireValue(
    typeof code === 'string' && MUNICIPALITY_CODE_PATTERN.test(code),
    `${label}: needs a Montenegrin ISO code`
  );
  requireValue(
    typeof properties.name === 'string' && properties.name.trim().length > 0,
    `${label}: needs a name`
  );
  position(properties.labelPoint, `${label} labelPoint`);
  validateAreaEdges(properties, label);
}

function validateUnassignedWaterArea(properties, label) {
  requireValue(properties.kind === UNASSIGNED_WATER_KIND, `${label}: unexpected kind`);
  requireValue(
    !Object.hasOwn(properties, 'ISO3166-2'),
    `${label}: derived area must not have an ISO code`
  );
  const neighbours = properties.neighbouringMunicipalities;
  const neighboursAreValid = Array.isArray(neighbours) && neighbours.every(
    code => typeof code === 'string' && MUNICIPALITY_CODE_PATTERN.test(code)
  );
  requireValue(neighboursAreValid, `${label}: needs neighbouringMunicipalities`);
  requireValue(
    typeof properties.entityId === 'string' &&
    properties.entityId.startsWith(WATER_IDENTITY_PREFIX),
    `${label}: needs a derived unassigned-water entityId`
  );
  position(properties.labelPoint, `${label} labelPoint`);
  validateAreaEdges(properties, label);
}

// Validate municipality and derived unassigned-water polygons in one file.
export function validateMunicipalities(data, {requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {
    label: 'municipalities', geometryTypes: ['Polygon', 'MultiPolygon'], requireAdopted, contractsDirectory
  });
  for (const [index, feature] of data.features.entries()) {
    const label = `municipality area ${index}`;
    const kind = feature.properties.kind;
    if (kind === MUNICIPALITY_KIND) {
      validateMunicipalityArea(feature.properties, label);
    } else if (kind === UNASSIGNED_WATER_KIND) {
      validateUnassignedWaterArea(feature.properties, label);
    } else {
      throw new Error(`${label}: unsupported area kind ${kind}`);
    }
  }
  return count;
}

// Validate the areas of settlements. Which settlement an area belongs to is checked against the settlements.
export function validateSettlementAreas(data, {label = 'settlement-areas.geojson', requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {
    label, geometryTypes: ['Polygon', 'MultiPolygon'], requireKind: true, requireAdopted, contractsDirectory
  });
  for (const {properties} of data.features) {
    requireValue(properties.kind === 'settlement-area', `${label}: wrong kind ${properties.kind}`);
    requireValue(typeof properties.name === 'string' && properties.name.trim().length > 0, `${label}: an area needs its name`);
  }
  return count;
}

// A settlement has at most one area.
export function validateSettlementsOfAreas(areas, settlements) {
  const settlementIds = new Set(settlements.features.map(({properties}) => properties.entityId));
  const claimedIds = new Set();
  for (const {properties: {entityId, settlementEntityId}} of areas.features) {
    if (settlementEntityId === undefined) continue;
    requireValue(settlementIds.has(settlementEntityId), `settlement area ${entityId}: settlement ${settlementEntityId} not found`);
    requireValue(!claimedIds.has(settlementEntityId), `settlement ${settlementEntityId} has more than one area`);
    claimedIds.add(settlementEntityId);
  }
}

// Validate point settlements with a supported rank, municipality code and source.
export function validateSettlements(data, {requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {
    label: 'settlements', geometryTypes: ['Point'], requireAdopted, contractsDirectory
  });
  for (const feature of data.features) {
    const properties = feature.properties;
    requireValue(properties.kind === 'settlement', 'Settlement has an unexpected kind');
    requireValue(
      typeof properties.name === 'string' && properties.name.trim().length > 0,
      'Settlement needs a name'
    );
    requireValue(
      settlementRanks.has(properties.rank),
      'Settlement has an unsupported rank'
    );
    requireValue(
      typeof properties.place === 'string' && properties.place.length > 0 &&
      typeof properties.municipality === 'string' &&
      /^ME-\d+$/.test(properties.municipality) &&
      typeof properties.source === 'string' && properties.source.length > 0,
      'Settlement lacks place, municipality or source'
    );
    const [longitude, latitude] = feature.geometry.coordinates;
    requireValue(
      longitude >= 17.8 && longitude <= 21 && latitude >= 41.3 && latitude <= 44.1,
      'Settlement outside Montenegro'
    );
  }
  return count;
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

export function validateTransitRoutes(data) {
  requireValue(data?.version === 1 && Array.isArray(data.routes) && data.routes.length > 0, 'Invalid transit routes');
  requireValue(Number.isFinite(Date.parse(data.retrievedAt)) && typeof data.source === 'string' && data.source.length > 0, 'Transit routes metadata missing');
  const routeNumbers = new Set();
  for (const route of data.routes) {
    const routeLabel = `route ${route.number || route.name || '(unknown)'}`;
    if (route.number !== undefined) {
      requireValue(typeof route.number === 'string' && route.number.length > 0, `${routeLabel}: invalid number`);
      const hasOsmDirection = route.directions.some(direction => typeof direction.entityId === 'string');
      const source = hasOsmDirection ? 'osm' : 'epodgorica';
      const municipalityScope = route.directions
        .map(direction => direction.fromMunicipality || direction.toMunicipality || '')
        .sort()[0] || source;
      const identity = hasOsmDirection
        ? route.directions.map(direction => direction.entityId).filter(Boolean).sort().join(',')
        : 'city';
      const uniquenessKey = `${route.network}|${route.number}|${source}|${municipalityScope}|${identity}`;
      requireValue(!routeNumbers.has(uniquenessKey), `${routeLabel}: duplicate route number`);
      routeNumbers.add(uniquenessKey);
    }
    if (route.name !== undefined) {
      requireValue(typeof route.name === 'string' && route.name.length > 0, `${routeLabel}: name must be a nonempty string`);
    }
    requireValue(route.network === 'bus' || route.network === 'intercity', `${routeLabel}: invalid network type`);
    if (route.colour) {
      requireValue(/^#[0-9a-fA-F]{6}$/.test(route.colour), `${routeLabel}: invalid colour format`);
    }
    requireValue(Array.isArray(route.directions) && route.directions.length >= 1, `${routeLabel}: missing directions`);
    for (const direction of route.directions) {
      requireValue(typeof direction.headsign === 'string', `${routeLabel}: direction missing headsign`);
      // entityId/entityVersion are required for OSM directions
      if (route.network === 'intercity' || direction.entityId) {
        const isLocal = isLocalId(direction.entityId);
        requireValue(isLocal || (typeof direction.entityId === 'string' && /^relation\/\d+$/.test(direction.entityId)),
          `${routeLabel}: direction missing entityId`);
        requireValue(isLocal || (Number.isInteger(direction.entityVersion) && direction.entityVersion >= 1),
          `${routeLabel}: direction missing entityVersion`);
      }
      requireValue(Array.isArray(direction.stops) && direction.stops.length >= 2, `${routeLabel}: direction has fewer than 2 stops`);
      for (const stop of direction.stops) {
        if (typeof stop === 'string') {
          // City route stop ID
          requireValue(stop.length > 0, `${routeLabel}: empty stop ID in direction`);
        } else if (stop.turn !== undefined) {
          position(stop.turn, `${routeLabel}: turn point`);
        } else {
          // OSM stop object with position
          requireValue(typeof stop.id === 'string' && (/^node\/\d+$/.test(stop.id) || isLocalId(stop.id)),
            `${routeLabel}: OSM stop missing node ID`);
          requireValue(Array.isArray(stop.coordinates) && stop.coordinates.length === 2,
            `${routeLabel}: OSM stop missing coordinates`);
          requireValue(stop.coordinates.every(Number.isFinite),
            `${routeLabel}: OSM stop has non-finite coordinates`);
        }
      }
    }
  }
  return data.routes.length;
}

function collectRouteStopIds(direction) {
  const stopIds = [];
  for (const stop of direction.stops) {
    const isTurnPoint = typeof stop === 'object' && stop.turn !== undefined;
    if (!isTurnPoint) stopIds.push(typeof stop === 'string' ? stop : stop.id);
  }
  for (const variant of direction.variants || []) {
    for (const stop of variant.stops) {
      stopIds.push(typeof stop === 'string' ? stop : stop.id);
    }
  }
  return stopIds;
}

// Cross-validate that stop lines match routes and route stops exist in the stops file.
export function validateStopsAndRoutes(stopsData, routesData, transitNetwork = null) {
  const stopIds = new Set(stopsData.features.map(feature => feature.id));
  const expectedLines = {};

  for (const route of routesData.routes) {
    const routeNumber = route.number;
    if (!routeNumber) continue;
    for (const direction of route.directions) {
      for (const stopId of collectRouteStopIds(direction)) {
        if (stopId.startsWith('node/')) continue;
        requireValue(stopIds.has(stopId), `Route references stop ${stopId} not in transport-stops.geojson`);
        expectedLines[stopId] = expectedLines[stopId] || new Set();
        expectedLines[stopId].add(routeNumber);
      }
    }
  }

  for (const feature of stopsData.features) {
    const stopId = feature.id;
    const actualLines = Array.isArray(feature.properties?.lines) ? feature.properties.lines : [];
    const expected = expectedLines[stopId] || new Set();
    const actual = new Set(actualLines);
    for (const line of expected) {
      requireValue(actual.has(line), `Stop ${stopId} missing line ${line} from routes`);
    }
    for (const line of actual) {
      requireValue(expected.has(line), `Stop ${stopId} has line ${line} not in routes`);
    }
  }

  if (transitNetwork) {
    validateCityRouteDirections(routesData, transitNetwork);
  }
}

function validateCityRouteDirections(routesData, transitNetwork) {
  const patternsByRoute = new Map();
  for (const pattern of transitNetwork.patterns || []) {
    const routeNumber = pattern.route;
    if (!patternsByRoute.has(routeNumber)) {
      patternsByRoute.set(routeNumber, new Set());
    }
    const sampleTrip = pattern.sampleTrip || '';
    if (sampleTrip.includes('_AB_')) patternsByRoute.get(routeNumber).add('AB');
    if (sampleTrip.includes('_BA_')) patternsByRoute.get(routeNumber).add('BA');
  }

  for (const route of routesData.routes) {
    const hasOsmDirection = route.directions.some(direction => typeof direction.entityId === 'string');
    if (hasOsmDirection) continue;
    const routeNumber = route.number;
    if (!routeNumber) continue;
    const expectedDirections = patternsByRoute.get(routeNumber);
    if (!expectedDirections || expectedDirections.size < 2) continue;
    requireValue(route.directions.length >= 2,
      `route ${routeNumber}: both directions present in source but missing in transit-routes.json`);
  }
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
    for (const field of ['addr:housenumber', 'building_number', 'display_number', 'lamela', 'addr:street']) {
      const value = properties[field];
      if (value === undefined) continue;
      const isNumber = ['addr:housenumber', 'building_number', 'display_number'].includes(field);
      requireValue(addressText(value) && (!isNumber || !noNumber(value, houseNumber)), `Invalid building ${field}`);
    }
    const hasKnownId = /^way\/\d+$/.test(feature.id) || isLocalId(feature.id);
    const hasUniqueSource = typeof feature.id === 'string' && hasKnownId && properties.osm_id === feature.id && !sourceIDs.has(feature.id);
    requireValue(hasUniqueSource, 'Invalid or duplicate building source ID');
    const hasUniqueFootprint = Number.isInteger(footprintIndex) && footprintIndex >= 0 && footprintIndex < buildings.features.length && !footprints.has(footprintIndex);
    requireValue(hasUniqueFootprint, 'Invalid or duplicate footprint reference');
    const addressSources = properties.address_sources;
    const hasSources = Array.isArray(addressSources) && addressSources.length > 0 && addressSources.every(identifier => /^(way|node)\/\d+$/.test(identifier) || isLocalId(identifier));
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
  const isAllowed = addressText(value) && value.length <= (rule?.maxLength ?? Infinity);
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
    const expectedIds = [...matchingRoads].sort(compareRoadIds);
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
  if (filename === 'border-edges.geojson') return ['LineString'];
  if (filename === 'settlements.geojson') return ['Point'];
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
    requireValue(/^node\/\d+$/.test(properties.entityId) || isLocalId(properties.entityId), `${name}: invalid node identity`);
    requireValue(!seenEntityIds.has(properties.entityId), `${name}: duplicate entityId`);
    seenEntityIds.add(properties.entityId);
  }
  requireValue(count > 0, 'Empty road nodes snapshot');
  return count;
}

// A road or junction that came from the editor keeps its local ID wherever it is named.
const isIdentifier = value => (Number.isSafeInteger(value) && value >= 1) || isLocalId(value);

function roadIdentifiers(roads) {
  const identifiers = new Set();
  for (const {properties: {entityId}} of roads.features) {
    const match = entityId?.match(/^way\/(\d+)$/);
    if (match) identifiers.add(Number(match[1]));
    else if (isLocalId(entityId)) identifiers.add(entityId);
  }
  return identifiers;
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

// The junctions each road ends at, by the ID that turn rules name it with.
function junctionsByRoad(roads) {
  const junctions = new Map();
  for (const {properties: {entityId, startNode, endNode}} of roads.features) {
    const match = entityId?.match(/^way\/(\d+)$/);
    const id = match ? Number(match[1]) : entityId;
    if (!junctions.has(id)) junctions.set(id, new Set());
    for (const node of [startNode, endNode]) if (node !== undefined) junctions.get(id).add(node);
  }
  return junctions;
}

// A rule through one junction is about turning there, so both of its roads end there.
function requireRoadsAtJunction({from, to, viaNodes, viaWays}, junctions, label) {
  if (viaWays !== undefined || viaNodes?.length !== 1) return;
  for (const road of [from, to]) {
    requireValue(junctions.get(road).has(viaNodes[0]), `${label}: road ${road} does not end at junction ${viaNodes[0]}`);
  }
}

// Turn restrictions: structured JSON with OSM identity and from/to/via refs.
export function validateTurnRestrictions(data, roads, roadNodes) {
  requireValue(data?.entitySchemaVersion === 1, 'turn-restrictions.json: missing entitySchemaVersion');
  requireValue(Array.isArray(data.restrictions), 'turn-restrictions.json: missing restrictions array');
  const roadIds = roadIdentifiers(roads);
  const endNodeIds = roadEndNodeIds(roads);
  const nodeIds = roadNodePointIds(roadNodes);
  const allowedViaNodes = new Set([...nodeIds, ...endNodeIds]);
  const junctions = junctionsByRoad(roads);

  for (const [index, restriction] of data.restrictions.entries()) {
    const label = `restriction ${index} (${restriction.entityId})`;
    const isLocal = isLocalId(restriction.entityId);
    requireValue(isLocal || /^relation\/\d+$/.test(restriction.entityId), `${label}: invalid entityId`);
    requireValue(
      isLocal || (Number.isSafeInteger(restriction.entityVersion) && restriction.entityVersion >= 1),
      `${label}: invalid entityVersion`
    );
    requireValue(
      RESTRICTION_VALUES.has(restriction.restriction),
      `${label}: unknown restriction value: ${restriction.restriction}`
    );
    requireValue(isIdentifier(restriction.from), `${label}: invalid from road`);
    requireValue(isIdentifier(restriction.to), `${label}: invalid to road`);
    requireValue(
      roadIds.has(restriction.from),
      `${label}: from way ${restriction.from} not found in roads.geojson`
    );
    requireValue(
      roadIds.has(restriction.to),
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
          roadIds.has(viaWayId),
          `${label}: via way ${viaWayId} not found in roads.geojson`
        );
      }
    }
  }
  for (const [index, restriction] of data.restrictions.entries()) {
    requireRoadsAtJunction(restriction, junctions, `restriction ${index} (${restriction.entityId})`);
  }
  return {count: data.restrictions.length};
}

// Roads that end at one junction end at one place, or the junction would not be one.
function requireSingleJunctionPositions(roads) {
  const positionByNode = new Map();
  for (const {geometry, properties} of roads.features) {
    const ends = [[properties.startNode, geometry.coordinates[0]], [properties.endNode, geometry.coordinates.at(-1)]];
    for (const [node, coordinate] of ends) {
      if (node === undefined) continue;
      const known = positionByNode.get(node) ?? coordinate;
      const isSamePlace = known[0] === coordinate[0] && known[1] === coordinate[1];
      requireValue(isSamePlace, `roads.geojson: roads end at junction ${node} in different places`);
      positionByNode.set(node, known);
    }
  }
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
        requireValue(isIdentifier(nodeValue), `${name}: ${nodeField} must be an OSM number or a local ID`);
      }
      if (levelValue !== undefined) {
        requireValue(Number.isInteger(levelValue), `${name}: ${levelField} must be an integer`);
      }
      const hasNode = nodeValue !== undefined;
      const hasLevel = levelValue !== undefined;
      // An end drawn in the editor has a level but is not an OSM node.
      const isDrawnEnd = isLocalId(properties.entityId) && !hasNode;
      requireValue(isDrawnEnd || hasNode === hasLevel, `${name}: ${nodeField} and ${levelField} must appear together`);
    }
  }
  requireSingleJunctionPositions(data);
  requireValue(count > 0, 'Empty roads snapshot');
  return count;
}

// Named protected areas carry names for the map, not land cover: one kind, a name and the OSM tag that selected them.
// The tags are the extractor's PROTECTED_AREA_TAGS (osm_extract/protected_areas.py); a data test keeps them equal.
export const protectedAreaTags = new Set(['leisure=nature_reserve', 'boundary=protected_area', 'boundary=national_park']);

export function validateProtectedAreas(data, {label = 'protected-areas.geojson', requireAdopted = false, contractsDirectory} = {}) {
  const count = validateCollection(data, {label, geometryTypes: ['Polygon', 'MultiPolygon'], requireKind: true, requireAdopted, contractsDirectory});
  for (const feature of data.features) {
    const properties = feature.properties;
    requireValue(properties.kind === 'protected-area', `${label}: wrong kind ${properties.kind}`);
    requireValue(typeof properties.name === 'string' && properties.name.trim().length > 0, `${label}: a protected area needs its name`);
    requireValue(protectedAreaTags.has(properties.osmTag), `${label}: unsupported osmTag ${properties.osmTag}`);
  }
  return count;
}

function validateReliefSource(data, {label, requireAdopted = false, contractsDirectory}) {
  const count = validateRelief(data, {label, contractsDirectory});
  if (requireAdopted) {
    requireValue(data.entitySchemaVersion === 1, `${label}: requires entitySchemaVersion 1`);
    validateSourceEntities(data, {label, contractsDirectory});
  }
  return count;
}

// The relief contract's directions: rims with the river on their right, contours with higher ground on their left.
function validateReliefDirections(root) {
  const source = name => JSON.parse(fs.readFileSync(path.join(root, 'data/sources', name)));
  const reversedRims = reversedCanyonRims(source('canyon-rims.geojson'), source('water.geojson'));
  requireValue(reversedRims.length === 0, `canyon-rims.geojson: ${reversedRims.length} rims run with the river on their left`);
  const contours = reversedClosedContours(source('contours.geojson'), source('summits.geojson'));
  requireValue(contours.judgedCount > 0, 'contours.geojson: no closed contour to check its direction');
  requireValue(contours.reversed.length === 0, `contours.geojson: ${contours.reversed.length} closed contours run with higher ground on their right`);
}

// The source files that reviewed editor changesets changed after their build.
function filesWithCorrections(root) {
  const ledgerPath = path.join(root, 'data/sources/editor-corrections.json');
  if (!fs.existsSync(ledgerPath)) return new Set();
  const {corrections} = JSON.parse(fs.readFileSync(ledgerPath));
  return new Set(corrections.map(({filename}) => filename));
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
  const stopsData = JSON.parse(stopBytes);
  const stopCount = validateStops(stopsData, {requireAdopted: true, contractsDirectory});
  requireValue(stopCount === stopProvenance.features && stopBytes.length === stopProvenance.bytes && crypto.createHash('sha256').update(stopBytes).digest('hex') === stopProvenance.sha256 && Number.isFinite(Date.parse(stopProvenance.retrieved_at)), 'Stop snapshot provenance mismatch');

  // Validate transit routes and cross-check with stops
  const routesBytes = fs.readFileSync(path.join(root, 'data/sources/transit-routes.json'));
  const routesProvenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/transit-routes.provenance.json')));
  const routesData = JSON.parse(routesBytes);
  requireValue(validateTransitRoutes(routesData) === routesProvenance.routes && routesBytes.length === routesProvenance.bytes && crypto.createHash('sha256').update(routesBytes).digest('hex') === routesProvenance.sha256, 'Transit routes provenance mismatch');
  validateStopsAndRoutes(stopsData, routesData, transit);

  const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/provenance.json')));
  const landWaterContractRules = landWaterRules(contractsDirectory);
  requireValue(labelProvenance.upstream_snapshot===provenance.upstream_snapshot && labelProvenance.direct_building_addresses+labelProvenance.node_derived_addresses+(labelProvenance.local_addresses ?? 0)===labelCount, 'Building label source/count metadata mismatch');
  requireValue(Number.isFinite(Date.parse(provenance.upstream_snapshot)) && typeof provenance.coverage === 'string', 'Source timestamp/coverage missing');
  const specificValidators = {
    'border-edges.geojson': validateBorderEdges,
    'municipalities.geojson': validateMunicipalities,
    'settlement-areas.geojson': validateSettlementAreas,
    'settlements.geojson': validateSettlements,
    'contours.geojson': validateReliefSource,
    'summits.geojson': validateReliefSource,
    'slopes.geojson': validateReliefSource,
    'ridges.geojson': validateReliefSource,
    'canyon-rims.geojson': validateReliefSource,
    'protected-areas.geojson': validateProtectedAreas,
  };
  for (const [name, expected] of Object.entries(provenance.layers)) {
    requireValue(/^[\w-]+(\.geojson|\.json)$/.test(name), 'Unsafe provenance layer path');
    const bytes = fs.readFileSync(path.join(root, 'data/sources', name));
    if (name.endsWith('.geojson')) {
      const isLand = name === 'land.geojson';
      const isWater = name === 'water.geojson';
      const allowedKinds = isLand ? landWaterContractRules.landKinds : isWater ? landWaterContractRules.waterKinds : undefined;
      const geometryTypes = sourceGeometryTypes(name);
      const specificValidator = specificValidators[name];
      const count = specificValidator
        ? specificValidator(JSON.parse(bytes), {label: name, requireAdopted: true, contractsDirectory})
        : validateCollection(JSON.parse(bytes), {
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
  const readSource = name => JSON.parse(fs.readFileSync(path.join(root, 'data/sources', name)));
  validateSettlementsOfAreas(readSource('settlement-areas.geojson'), readSource('settlements.geojson'));
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
  validateReliefDirections(root);
  const relief = provenance.relief;
  requireValue(relief && relief.reportFile === '.build/relief-report.json', 'Relief provenance missing');
  const summary = relief.summary;
  requireValue(summary.contourCrossingPairs === 0, 'Relief report has contour crossings');
  const heightChecks = summary.summitHeightChecks;
  requireValue(heightChecks && heightChecks.ok + heightChecks.mismatch + heightChecks.missing === summary.summitFeatures, 'Relief summit height check counts disagree');
  requireValue(Array.isArray(summary.greenKindsPresentInLand) && summary.greenKindsPresentInLand.every(kind => typeof kind === 'string'), 'Invalid green kinds in relief summary');
  const parameters = relief.buildParameters;
  const landContractGreenKinds = [...landWaterContractRules.extractedLandKinds];
  requireValue(parameters && Array.isArray(parameters.greenKinds) && parameters.greenKinds.length > 0 && parameters.greenKinds.every(kind => typeof kind === 'string'), 'Relief green kinds missing from provenance build parameters');
  requireValue(
    JSON.stringify(parameters.greenKinds) === JSON.stringify(landContractGreenKinds),
    'Relief green kinds disagree with the land contract'
  );
  requireValue(Array.isArray(parameters.greenKindsPresentInLand) && parameters.greenKindsPresentInLand.every(kind => parameters.greenKinds.includes(kind)), 'Relief green kinds in land disagree with build parameters');
  const landFeatures = JSON.parse(fs.readFileSync(path.join(root, 'data/sources/land.geojson')));
  const greenKindsInLand = [...new Set(landFeatures.features.map(feature => feature.properties.kind))]
    .filter(kind => landContractGreenKinds.includes(kind))
    .sort();
  requireValue(
    JSON.stringify(parameters.greenKindsPresentInLand) === JSON.stringify(greenKindsInLand) &&
      JSON.stringify(summary.greenKindsPresentInLand) === JSON.stringify(greenKindsInLand),
    'Relief green kinds in land disagree with land.geojson'
  );
  requireValue(parameters.minimumAreaSquareMetres === 2500, 'Relief minimum slope area changed without review');
  requireValue(parameters.ridgeMinimumLengthMetres === 100 && parameters.summitLinkDistanceMetres === 50 && parameters.ridgeSimplificationToleranceDegrees > 0, 'Relief ridge parameters changed without review');
  requireValue(parameters.canyonRimJoinGapMetres === 60 && parameters.canyonRimMinimumLengthMetres === 100, 'Relief rim parameters changed without review');
  requireValue(relief.retiredBuildParameters?.radiusMetres === 400, 'Retired ridge radius missing from relief provenance');
  requireValue(relief.sources && ['contour', 'summit', 'slope', 'ridge', 'canyon-rim'].every(kind => typeof relief.sources[kind] === 'string' && relief.sources[kind].length > 0), 'Relief layer sources missing from provenance');
  const correctedFiles = filesWithCorrections(root);
  const reportPath = path.join(root, relief.reportFile);
  if (fs.existsSync(reportPath)) {
    const reportBytes = fs.readFileSync(reportPath);
    requireValue(reportBytes.length === relief.reportBytes && crypto.createHash('sha256').update(reportBytes).digest('hex') === relief.reportSha256, 'Relief report provenance mismatch');
    const report = JSON.parse(reportBytes);
    requireValue(report.schemaVersion === 1 && report.contours.crossingPairs === 0, 'Relief report has contour crossings or an unsupported schema');
    requireValue(report.summits.items.length === report.summits.mismatches, 'Relief summit mismatch report is incomplete');
    requireValue(report.canyonRims.riverBanks.length === 4, 'Relief report must describe both banks of both rivers');
    requireValue(report.license.attribution === copernicusAttribution, 'Copernicus attribution changed');
    for (const [name, expected] of Object.entries(report.layers)) {
      // A reviewed correction came after the build this report describes.
      if (correctedFiles.has(name)) continue;
      requireValue(provenance.layers[name]?.features === expected.features && provenance.layers[name]?.bytes === expected.bytes && provenance.layers[name]?.sha256 === expected.sha256, `${name}: relief report differs from provenance`);
    }
  }
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
  console.log(`Validated geometry, source hashes, and ${checkData(rootDirectory, {contractsDirectory})} places. This is structural validation; run make -C data check-topology for GIS topology.`);
}
