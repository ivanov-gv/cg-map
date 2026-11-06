// Stable POI visibility (docs/ui-ux/features/poi-visibility.md). Pure policy: no DOM, storage, or map access.
import {placeIconId, sharedPlaceIcon} from './poi-icons.js';

// Above MapLibre's maximum zoom: with no requested place, the marker layer is never cut off.
const unboundedMaxZoom = 24;

// Validate the shared level table before any marker is admitted.
export function parseVisibilityConfig(rawConfig) {
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
  // A place with no level must never reach the earliest, individually reviewed level.
  if (!thresholds.has(rawConfig.legacyFallbackLevel) || rawConfig.legacyFallbackLevel === 1)
    throw new Error('Place visibility: invalid fallback level');
  return {
    levels: rawConfig.levels.map(levelEntry => levelEntry.level),
    thresholds,
    fallback: rawConfig.legacyFallbackLevel
  };
}

// A missing level is a legacy input and takes the latest fallback. A present but invalid level fails visibly:
// it must never silently become high priority.
export function normalizePlaces(features, config) {
  return features.map(feature => {
    const level =
      feature.properties.visibilityLevel === undefined ? config.fallback : feature.properties.visibilityLevel;
    if (!config.thresholds.has(level))
      throw new Error(`Place ${feature.properties.id}: invalid visibilityLevel ${level}`);
    return {
      ...feature,
      properties: {...feature.properties, visibilityLevel: level}
    };
  });
}

// Producers require explicit reviewed levels; consumers may normalize only missing legacy values.
export function assertPublishedPlaces(features, config) {
  for (const feature of features)
    if (!config.thresholds.has(feature.properties.visibilityLevel))
      throw new Error(`Place ${feature.properties.id}: published snapshot needs a valid visibilityLevel`);
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
  compareCodePoints(left.properties.id, right.properties.id);

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
    const ids = members.map(feature => feature.properties.id).sort(compareCodePoints);
    const key = ids.length === 1 ? ids[0] : `shared:${JSON.stringify(ids)}`;
    for (const id of ids) keys.set(id, key);
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
  return {
    markerKey,
    band,
    first: isFirstBand,
    category: leadProperties.category,
    visibilityLevel: leadProperties.visibilityLevel,
    icon: isShared ? sharedPlaceIcon : placeIconId(leadProperties.category),
    count: isShared ? String(activeMembers.length) : '',
    label: isShared ? '' : placeLabel(leadProperties),
    activeIds: JSON.stringify(activeMembers.map(feature => feature.properties.id))
  };
}

// One feature per marker per zoom band. Built only when the filter changes, never during camera movement.
// rank is a total order from the band's level and stable ID; it does not depend on input order or the camera.
export function buildPlaceMarkers(features, markerKeysById) {
  const markers = [];
  for (const members of groupByCoordinates(features).values()) {
    const sortedMembers = [...members].sort(comparePlaces);
    const levels = [...new Set(sortedMembers.map(feature => feature.properties.visibilityLevel))];
    const markerKey = markerKeysById.get(sortedMembers[0].properties.id);
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
export function requestedPlaceMarker(place, filtered, markerKeysById, config) {
  if (!place) return {features: [], maxzoom: unboundedMaxZoom};
  const placeCoordinateKey = coordinateKey(place);
  const levels = filtered
    .filter(feature => coordinateKey(feature) === placeCoordinateKey)
    .map(feature => feature.properties.visibilityLevel);
  const properties = {
    ...markerProperties([place], markerKeysById.get(place.properties.id), 'requested', false),
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
export function listingsAtHits(hits, placesById) {
  const listings = new Map();
  for (const hit of hits) {
    const activeIds = JSON.parse(hit.properties.activeIds ?? '[]');
    for (const id of activeIds) {
      if (placesById.has(id)) listings.set(id, placesById.get(id));
    }
  }
  return [...listings.values()].sort(comparePlaces);
}
