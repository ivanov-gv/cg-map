// Stable POI visibility (docs/ui-ux/features/poi-visibility.md). Pure policy: no DOM, storage, or map access.
import {placeIconId,SHARED_PLACE_ICON} from './poi-icons.js';

export function parseVisibilityConfig(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.levels) || !raw.levels.length) throw new Error('Place visibility: unsupported configuration');
  raw.levels.forEach((entry, index) => {
    if (entry.level !== index + 1 || !Number.isFinite(entry.minZoom) || (index && entry.minZoom <= raw.levels[index - 1].minZoom)) throw new Error('Place visibility: levels must be consecutive with increasing zoom');
  });
  const thresholds = new Map(raw.levels.map(entry => [entry.level, entry.minZoom]));
  // A place with no level must never reach the earliest, individually reviewed level.
  if (!thresholds.has(raw.legacyFallbackLevel) || raw.legacyFallbackLevel === 1) throw new Error('Place visibility: invalid fallback level');
  return {levels: raw.levels.map(entry => entry.level), thresholds, fallback: raw.legacyFallbackLevel};
}

// A missing level is a legacy input and takes the latest fallback. A present but invalid level fails visibly:
// it must never silently become high priority.
export function normalizePlaces(features, config) {
  return features.map(feature => {
    const level = feature.properties.visibilityLevel === undefined ? config.fallback : feature.properties.visibilityLevel;
    if (!config.thresholds.has(level)) throw new Error(`Place ${feature.properties.id}: invalid visibilityLevel ${level}`);
    return {...feature, properties: {...feature.properties, visibilityLevel: level}};
  });
}

export function assertPublishedPlaces(features, config) {
  for (const feature of features) if (!config.thresholds.has(feature.properties.visibilityLevel)) throw new Error(`Place ${feature.properties.id}: published snapshot needs a valid visibilityLevel`);
}

export function compareCodePoints(a, b) {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
}

export const comparePlaces = (a, b) => a.properties.visibilityLevel - b.properties.visibilityLevel || compareCodePoints(a.properties.id, b.properties.id);

const coordinateKey = feature => feature.geometry.coordinates.join(',');

function byCoordinates(features) {
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
  for (const members of byCoordinates(directory).values()) {
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
  for (const members of byCoordinates(directory).values()) {
    const levels = [...new Set(members.map(feature => feature.properties.visibilityLevel))].sort((a, b) => a - b);
    levels.forEach((start, index) => {
      for (const end of levels.slice(index + 1)) bands.set(bandId(start, end), {id: bandId(start, end), start, end});
    });
  }
  // Drawn bottom to top: an earlier level stays above a later one.
  return [...bands.values()].sort((a, b) => b.start - a.start || (b.end ?? Infinity) - (a.end ?? Infinity));
}

const placeLabel = properties => properties['name:en'] ?? properties.name ?? '';

function markerProperties(active, markerKey, band, first) {
  const lead = active[0].properties, shared = active.length > 1;
  return {markerKey, band, first, category: lead.category, visibilityLevel: lead.visibilityLevel,
    icon: shared ? SHARED_PLACE_ICON : placeIconId(lead.category), count: shared ? String(active.length) : '',
    label: shared ? '' : placeLabel(lead), activeIds: JSON.stringify(active.map(feature => feature.properties.id))};
}

// One feature per marker per zoom band. Built only when the filter changes, never during camera movement.
// rank is a total order from the band's level and stable ID; it does not depend on input order or the camera.
export function buildPlaceMarkers(features, keys) {
  const markers = [];
  for (const members of byCoordinates(features).values()) {
    const sorted = [...members].sort(comparePlaces);
    const levels = [...new Set(sorted.map(feature => feature.properties.visibilityLevel))];
    const markerKey = keys.get(sorted[0].properties.id);
    levels.forEach((start, index) => {
      const active = sorted.filter(feature => feature.properties.visibilityLevel <= start);
      markers.push({type: 'Feature', geometry: {type: 'Point', coordinates: [...sorted[0].geometry.coordinates]},
        properties: {...markerProperties(active, markerKey, bandId(start, levels[index + 1]), index === 0), start}});
    });
  }
  markers.sort((a, b) => a.properties.start - b.properties.start || compareCodePoints(a.properties.markerKey, b.properties.markerKey));
  markers.forEach((marker, rank) => {marker.properties.rank = rank;});
  return markers;
}

// The one requested listing below its threshold. It hands over to the ordinary marker at the earliest zoom where
// any listing at that location is admitted, so the same position never holds two icons.
export function requestedPlaceMarker(place, filtered, keys, config) {
  if (!place) return {features: [], maxzoom: 24};
  const key = coordinateKey(place);
  const levels = filtered.filter(feature => coordinateKey(feature) === key).map(feature => feature.properties.visibilityLevel);
  const properties = {...markerProperties([place], keys.get(place.properties.id), 'requested', false), label: place.properties.name};
  return {maxzoom: config.thresholds.get(Math.min(place.properties.visibilityLevel, ...levels)),
    features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [...place.geometry.coordinates]}, properties}]};
}

// Icon-only layers ignore every collision, so a name, an address, or another icon can never remove a marker.
// Names sit in their own collision-aware layers below the road and address labels, which are placed first.
export function placeLayers(bands, config) {
  const names = [], icons = [];
  for (const band of bands) {
    const range = {minzoom: config.thresholds.get(band.start), ...(band.end ? {maxzoom: config.thresholds.get(band.end)} : {})};
    const base = {type: 'symbol', source: 'places', ...range, filter: ['==', ['get', 'band'], band.id]};
    names.push({...base, id: `place-names-${band.id}`, layout: {'symbol-sort-key': ['get', 'rank'], 'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 1.1], 'text-max-width': 10}, paint: {'text-color': '#304c3e', 'text-halo-color': '#fffff9', 'text-halo-width': 2}});
    icons.push({...base, id: `place-icons-${band.id}`, layout: {'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['-', 0, ['get', 'rank']], 'text-field': ['get', 'count'], 'text-font': ['Open Sans Semibold'], 'text-size': 12, 'text-allow-overlap': true, 'text-ignore-placement': true}, paint: {'text-color': '#ffffff'}});
  }
  return {names, icons};
}

// Listings under a map tap: every marker's admitted members, once each, in a stable order.
export function listingsAtHits(hits, byId) {
  const listings = new Map();
  for (const hit of hits) for (const id of JSON.parse(hit.properties.activeIds ?? '[]')) if (byId.has(id)) listings.set(id, byId.get(id));
  return [...listings.values()].sort(comparePlaces);
}
