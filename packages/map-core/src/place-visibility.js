// Stable POI visibility (docs/ui-ux/features/poi-visibility.md). Pure policy: no DOM, storage, or map access.
import {placeCategory} from './place-category.js';
import {placeIconId, sharedPlaceIcon} from './poi-icons.js';

// Above MapLibre's maximum zoom: with no requested place, the marker layer is never cut off.
const unboundedMaxZoom = 24;

// Version 5 stores only `entityId`; the released data pin still stores only `id`, so that legacy copy is read until
// data switches. No feature ever has two competing identities: `entityId` wins when both are present.
const entityIdOf = feature => feature.properties.entityId ?? feature.properties.id;

function assertEntityIdentity(feature) {
  const entityId = entityIdOf(feature);
  if (typeof entityId !== 'string' || !entityId)
    throw new Error(`Place ${feature.properties.entityId ?? feature.properties.id ?? 'unknown'}: missing entity identity`);
}

// A JSON object may replace its own `toString`, so never use string interpolation to report an invalid value.
function formatInvalidLevel(level) {
  if (level === null || typeof level !== 'object') return String(level);
  try {
    return JSON.stringify(level) ?? typeof level;
  } catch {
    return typeof level;
  }
}

function assertPolicyDefaults(defaults, label, thresholds) {
  if (defaults === undefined) return;
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults))
    throw new Error(`Place visibility: ${label} defaults must be an object`);
  for (const [name, level] of Object.entries(defaults)) {
    if (level === 1 || !thresholds.has(level))
      throw new Error(`Place visibility: ${label} ${name}: invalid default level ${formatInvalidLevel(level)}`);
  }
}

function assertFallbackLevel(level, thresholds, origin) {
  if (!thresholds.has(level) || level === 1)
    throw new Error(`Place visibility: invalid ${origin} fallback level ${formatInvalidLevel(level)}`);
}

// Validate the shared level table and any policy defaults before any marker is admitted. A supplied policy owns the
// fallback; a consumer that has not loaded one still gets today's fallback for a POI with no level.
export function parseVisibilityConfig(rawConfig, policy) {
  if (rawConfig?.version !== 1 || !Array.isArray(rawConfig.levels) || !rawConfig.levels.length)
    throw new Error('Place visibility: unsupported configuration');
  rawConfig.levels.forEach((levelEntry, index) => {
    if (
      levelEntry.level !== index + 1 ||
      !Number.isFinite(levelEntry.minZoom) ||
      (index && levelEntry.minZoom <= rawConfig.levels[index - 1].minZoom)
    )
      throw new Error('Place visibility: levels must be consecutive with increasing zoom');
  });
  const thresholds = new Map(rawConfig.levels.map(levelEntry => [levelEntry.level, levelEntry.minZoom]));
  const hasPolicy = policy !== undefined && policy !== null;
  const fallback = hasPolicy ? policy.fallbackLevel : rawConfig.legacyFallbackLevel;
  const policyKinds = policy?.kinds ?? {};
  const policyCategories = policy?.categories ?? {};
  // Neither the fallback nor a policy default may reach the earliest, individually reviewed level.
  assertFallbackLevel(fallback, thresholds, hasPolicy ? 'policy' : 'contract');
  assertPolicyDefaults(policyKinds, 'kind', thresholds);
  assertPolicyDefaults(policyCategories, 'category', thresholds);
  return {
    levels: rawConfig.levels.map(levelEntry => levelEntry.level),
    thresholds,
    fallback,
    // Copy the validated tables: a caller mutating its policy later must not bypass validation.
    kindDefaults: {...policyKinds},
    categoryDefaults: {...policyCategories}
  };
}

function checkedVisibilityLevel(feature, source, level, config) {
  if (!config.thresholds.has(level))
    throw new Error(`Place ${entityIdOf(feature)}: invalid ${source} ${formatInvalidLevel(level)}`);
  return level;
}

// An exact kind rule precedes the category default; the category comes from the kind, not a stored copy.
function policyDefaultLevel(feature, config) {
  const {kind} = feature.properties;
  if (typeof kind === 'string' && kind && Object.hasOwn(config.kindDefaults, kind))
    return config.kindDefaults[kind];
  const category = placeCategory(feature.properties);
  return Object.hasOwn(config.categoryDefaults, category) ? config.categoryDefaults[category] : config.fallback;
}

// Returns one POI's zoom-band level for the Editor's preview and for normalizePlaces. A present invalid value fails
// visibly rather than being replaced by a lower-priority default.
export function placeVisibilityLevel(feature, config) {
  assertEntityIdentity(feature);
  const {visibilityOverride, visibilityLevel} = feature.properties;
  if (visibilityOverride !== undefined)
    return checkedVisibilityLevel(feature, 'visibilityOverride', visibilityOverride, config);
  if (visibilityLevel !== undefined)
    return checkedVisibilityLevel(feature, 'visibilityLevel', visibilityLevel, config);
  return checkedVisibilityLevel(feature, 'visibility policy default', policyDefaultLevel(feature, config), config);
}

export function normalizePlaces(features, config) {
  return features.map(feature => ({
    ...feature,
    properties: {...feature.properties, visibilityLevel: placeVisibilityLevel(feature, config)}
  }));
}

// Producers require explicit reviewed levels; consumers resolve a missing level from the policy, else the fallback.
export function assertPublishedPlaces(features, config) {
  for (const feature of features) {
    assertEntityIdentity(feature);
    if (!config.thresholds.has(feature.properties.visibilityLevel))
      throw new Error(`Place ${entityIdOf(feature)}: published snapshot needs a valid visibilityLevel`);
  }
}

// Use code-point order, independent of browser locale and input order.
export function compareCodePoints(left, right) {
  const leftCharacters = Array.from(left);
  const rightCharacters = Array.from(right);
  for (
    let characterIndex = 0;
    characterIndex < Math.min(leftCharacters.length, rightCharacters.length);
    characterIndex++
  ) {
    const difference = leftCharacters[characterIndex].codePointAt(0) - rightCharacters[characterIndex].codePointAt(0);
    if (difference) return difference;
  }
  return leftCharacters.length - rightCharacters.length;
}

export const comparePlaces = (left, right) =>
  left.properties.visibilityLevel - right.properties.visibilityLevel ||
  compareCodePoints(entityIdOf(left), entityIdOf(right));

const coordinateKey = feature => feature.geometry.coordinates.join(',');

// Co-located listings share one geographic marker.
function groupByCoordinates(features) {
  const groups = new Map();
  for (const feature of features) {
    const key = coordinateKey(feature);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(feature);
  }
  return groups;
}

// Marker identity comes from the whole directory, so it does not change with filters or levels.
export function markerKeys(directory) {
  const keys = new Map();
  for (const members of groupByCoordinates(directory).values()) {
    const ids = members.map(entityIdOf).sort(compareCodePoints);
    const key = ids.length === 1 ? ids[0] : `shared:${JSON.stringify(ids)}`;
    for (const entityId of ids) keys.set(entityId, key);
  }
  return keys;
}

const bandId = (start, end) => `${start}-${end ?? 'open'}`;

// A band is one zoom interval. Open bands hold everything that never changes; closed bands only exist where
// co-located listings with different levels change the marker's members at a later threshold.
export function placeBands(directory, config) {
  const bands = new Map(config.levels.map(level => [bandId(level), {id: bandId(level), start: level, end: null}]));
  for (const members of groupByCoordinates(directory).values()) {
    const levels = [...new Set(members.map(feature => feature.properties.visibilityLevel))].sort(
      (left, right) => left - right
    );
    levels.forEach((start, index) => {
      for (const end of levels.slice(index + 1)) bands.set(bandId(start, end), {id: bandId(start, end), start, end});
    });
  }
  // Drawn bottom to top: an earlier level stays above a later one.
  return [...bands.values()].sort(
    (left, right) => right.start - left.start || (right.end ?? Infinity) - (left.end ?? Infinity)
  );
}

const placeLabel = properties => properties['name:en'] ?? properties.name ?? '';

// Keep display labels separate from stable marker identity and membership.
function markerProperties(activeMembers, markerKey, band, isFirstBand) {
  const leadProperties = activeMembers[0].properties;
  const isShared = activeMembers.length > 1;
  const category = placeCategory(leadProperties);
  return {
    markerKey,
    band,
    first: isFirstBand,
    category,
    visibilityLevel: leadProperties.visibilityLevel,
    icon: isShared ? sharedPlaceIcon : placeIconId(category),
    count: isShared ? String(activeMembers.length) : '',
    label: isShared ? '' : placeLabel(leadProperties),
    // Keep the wire name for consumers; version 5 fills it with stable entity IDs.
    activeIds: JSON.stringify(activeMembers.map(entityIdOf))
  };
}

// One feature per marker per zoom band. Built only when the filter changes, never during camera movement.
// rank is a total order from the band's level and stable ID; it does not depend on input order or the camera.
export function buildPlaceMarkers(features, markerKeysByEntityId) {
  const markers = [];
  for (const members of groupByCoordinates(features).values()) {
    const sortedMembers = [...members].sort(comparePlaces);
    const levels = [...new Set(sortedMembers.map(feature => feature.properties.visibilityLevel))];
    const markerKey = markerKeysByEntityId.get(entityIdOf(sortedMembers[0]));
    levels.forEach((start, index) => {
      const activeMembers = sortedMembers.filter(feature => feature.properties.visibilityLevel <= start);
      markers.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [...sortedMembers[0].geometry.coordinates]
        },
        properties: {
          ...markerProperties(activeMembers, markerKey, bandId(start, levels[index + 1]), index === 0),
          start
        }
      });
    });
  }
  markers.sort(
    (left, right) =>
      left.properties.start - right.properties.start ||
      compareCodePoints(left.properties.markerKey, right.properties.markerKey)
  );
  markers.forEach((marker, rank) => {
    marker.properties.rank = rank;
  });
  return markers;
}

// The one requested listing below its threshold. It hands over to the ordinary marker at the earliest zoom where
// any listing at that location is admitted, so the same position never holds two icons.
export function requestedPlaceMarker(place, filtered, markerKeysByEntityId, config) {
  if (!place) return {features: [], maxzoom: unboundedMaxZoom};
  const placeCoordinateKey = coordinateKey(place);
  const levels = filtered
    .filter(feature => coordinateKey(feature) === placeCoordinateKey)
    .map(feature => feature.properties.visibilityLevel);
  const properties = {
    ...markerProperties([place], markerKeysByEntityId.get(entityIdOf(place)), 'requested', false),
    label: place.properties.name
  };
  return {
    maxzoom: config.thresholds.get(Math.min(place.properties.visibilityLevel, ...levels)),
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [...place.geometry.coordinates]
        },
        properties
      }
    ]
  };
}

// Icon-only layers ignore every collision, so a name, an address, or another icon can never remove a marker.
// Names sit in their own collision-aware layers below the road and address labels, which are placed first.
export function placeLayers(bands, config) {
  const names = [];
  const icons = [];
  for (const band of bands) {
    const zoomRange = {
      minzoom: config.thresholds.get(band.start),
      ...(band.end ? {maxzoom: config.thresholds.get(band.end)} : {})
    };
    const bandLayer = {
      type: 'symbol',
      source: 'places',
      ...zoomRange,
      filter: ['==', ['get', 'band'], band.id]
    };
    names.push({
      ...bandLayer,
      id: `place-names-${band.id}`,
      layout: {
        'symbol-sort-key': ['get', 'rank'],
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        'text-max-width': 10
      },
      paint: {
        'text-color': '#304c3e',
        'text-halo-color': '#fffff9',
        'text-halo-width': 2
      }
    });
    icons.push({
      ...bandLayer,
      id: `place-icons-${band.id}`,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['-', 0, ['get', 'rank']],
        'text-field': ['get', 'count'],
        'text-font': ['Open Sans Semibold'],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: {'text-color': '#ffffff'}
    });
  }
  return {names, icons};
}

// Listings under a map tap: every marker's admitted members, once each, in a stable order.
export function listingsAtHits(hits, placesByEntityId) {
  const listings = new Map();
  for (const hit of hits) {
    const activeIds = JSON.parse(hit.properties.activeIds ?? '[]');
    for (const entityId of activeIds) {
      if (placesByEntityId.has(entityId)) listings.set(entityId, placesByEntityId.get(entityId));
    }
  }
  return [...listings.values()].sort(comparePlaces);
}
