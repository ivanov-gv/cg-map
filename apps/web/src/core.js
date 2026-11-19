export const categories = {
  food: 'Eat & drink',
  sights: 'See & do',
  shops: 'Shops',
  stay: 'Stay',
  essentials: 'Essentials'
};
const cyrillicTransliteration = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  ђ: 'dj',
  е: 'e',
  ж: 'z',
  з: 'z',
  и: 'i',
  ј: 'j',
  к: 'k',
  л: 'l',
  љ: 'lj',
  м: 'm',
  н: 'n',
  њ: 'nj',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  ћ: 'c',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'c',
  ч: 'c',
  џ: 'dz',
  ш: 's',
  й: 'i',
  ы: 'y',
  ь: '',
  ъ: '',
  я: 'ya',
  ю: 'yu',
  щ: 'sh',
  э: 'e'
};
// Normalizes Latin and Cyrillic search text without changing the source listing.
export const normalizeSearchText = text =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ђ|đ/g, 'dj')
    .replace(/[а-яјљњћџ]/g, character => cyrillicTransliteration[character] ?? character)
    .trim();
// Search combines category eligibility with the listing's searchable text.
// A null category matches every listing; a non-null value filters to that category.
export function matchesPlaceSearch(feature, query, category) {
  const properties = feature.properties;
  const matchesCategory = category === null || properties.category === category;
  const searchableText = [
    properties.name,
    properties['name:en'],
    properties.kind,
    properties['addr:street']
  ].join(' ');
  return matchesCategory && normalizeSearchText(searchableText).includes(normalizeSearchText(query));
}

// A building record contributes one result at most. Street names describe addresses; numbers and entrance
// references describe the building itself. A query spanning both is still one address result.
function buildingSearchText(properties) {
  const entrances = properties.entrances ?? [];
  const streets = [properties['addr:street'], ...entrances.map(entrance => entrance.street)].filter(Boolean);
  const numbers = [
    properties['addr:housenumber'],
    properties.building_number && `Zgrada ${properties.building_number}`,
    properties.lamela && `Lamela ${properties.lamela}`,
    ...entrances.flatMap(entrance => [
      entrance.ref && `Ulaz ${entrance.ref}`,
      entrance.number,
      entrance.lamela && `Lamela ${entrance.lamela}`
    ])
  ].filter(Boolean);
  const streetForms = streets.flatMap(street => [street, street.split(/\s+/)[0]]);
  const streetNumberPairs = streetForms.flatMap(street => numbers.map(number => `${street} ${number}`));
  return {
    address: normalizeSearchText(streets.join(' ')),
    number: normalizeSearchText(numbers.join(' ')),
    pair: normalizeSearchText(streetNumberPairs.join(' ')),
    streetLeads: streetForms.map(street => normalizeSearchText(street))
  };
}

// Returns the result kind for a matching building label, or null when the query does not match it.
// Address wins over building only when a street (or street plus number) was what matched.
export function classifyBuildingMatch(feature, query) {
  const needle = normalizeSearchText(query);
  if (!needle) return null;
  const text = buildingSearchText(feature.properties ?? {});
  const matchesAddress = text.address.includes(needle);
  const matchesNumber = text.number.includes(needle);
  const matchesPair = text.pair.includes(needle);
  if (!matchesAddress && !matchesNumber && !matchesPair) return null;
  const startsWithStreet = text.streetLeads.some(lead => needle.startsWith(lead));
  return {kind: matchesAddress || (matchesPair && startsWithStreet) ? 'address' : 'building'};
}

// Row title for a building/address result, using only recorded address attributes.
export function buildingResultLabel(properties) {
  const number = properties.building_number ?? properties['addr:housenumber'];
  const street = properties['addr:street'];
  if (street && number) return `${street} ${number}`;
  if (street) return street;
  return number ? `Building ${number}` : 'Building';
}

// Places and recorded addresses share one nearest-first list. Building/address results need an explicit query:
// browsing with an empty query keeps the nearby place list, and any category narrows the list to places only.
export function selectSearchResults({
  places = [],
  buildingLabels = null,
  query = '',
  category = null,
  center,
  markerKeys = new Map(),
  limit = 40
}) {
  const results = [];
  for (const feature of places) {
    if (!matchesPlaceSearch(feature, query, category)) continue;
    results.push({
      kind: 'place',
      id: feature.properties.id,
      markerKey: markerKeys.get(feature.properties.id) ?? String(feature.properties.id),
      feature,
      coordinates: feature.geometry.coordinates
    });
  }
  if (category === null && normalizeSearchText(query)) {
    for (const feature of buildingLabels?.features ?? []) {
      const match = classifyBuildingMatch(feature, query);
      if (!match) continue;
      const properties = feature.properties;
      results.push({
        kind: match.kind,
        id: `footprint/${properties.footprintIndex}`,
        footprintIndex: properties.footprintIndex,
        label: buildingResultLabel(properties),
        feature,
        coordinates: feature.geometry.coordinates
      });
    }
  }
  return results
    .map(result => ({...result, distanceKilometres: distanceKilometres(center, result.coordinates)}))
    .sort((first, second) => first.distanceKilometres - second.distanceKilometres)
    .slice(0, limit);
}

// Approximate ground distance in kilometres, suitable for ordering nearby results.
export function distanceKilometres(first, second) {
  const radiansPerDegree = Math.PI / 180;
  const meanLatitudeRadians = ((first[1] + second[1]) / 2) * radiansPerDegree;
  const longitudeDifference = (first[0] - second[0]) * Math.cos(meanLatitudeRadians);
  const latitudeDifference = first[1] - second[1];
  const kilometresPerDegree = 111.2;
  return Math.hypot(longitudeDifference, latitudeDifference) * kilometresPerDegree;
}

// Only HTTP links may leave the details card; malformed or executable URLs are omitted.
export function safeWebsite(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
// Sorts a copy by distance; source feature order stays intact.
export function selectNearestPlaces(features, center, limit = 40) {
  return features
    .map(feature => ({
      feature,
      distanceKilometres: distanceKilometres(center, feature.geometry.coordinates)
    }))
    .sort((first, second) => first.distanceKilometres - second.distanceKilometres)
    .slice(0, limit);
}
export const featureCollection = features => ({type: 'FeatureCollection', features});
// Preserve the existing label while using its historical MiB-sized conversion.
const bytesPerMebibyte = 1048576;
export const formatBytes = bytes => `${(bytes / bytesPerMebibyte).toFixed(1)} MB`;
// Discover scale policy (docs/ui-ux/user-stories/discover.md). Scale is ground metres per CSS pixel; MapLibre uses 512px tiles.
const earthCircumferenceMetres = 40075016.686;
const mapTileSizePixels = 512;
export const metresPerPixel = (latitude, zoom) =>
  (earthCircumferenceMetres * Math.cos((latitude * Math.PI) / 180)) / (mapTileSizePixels * 2 ** zoom);
export const zoomForMetresPerPixel = (latitude, metresPerPixel) =>
  Math.log2(
    (earthCircumferenceMetres * Math.cos((latitude * Math.PI) / 180)) / (mapTileSizePixels * metresPerPixel)
  );
export const DEFAULT_CENTER = [19.26, 42.437];
// About 1 ground metre per CSS pixel over central Podgorica.
export const DISCOVER_ZOOM = Math.round(zoomForMetresPerPixel(DEFAULT_CENTER[1], 1) * 10) / 10;
// Location display states (D-06). Thresholds are the proposed initial tuning, not validated release values.
export const POSITION_FRESH_MILLISECONDS = 30000;
export const POSITION_TIMEOUT_MILLISECONDS = 15000;
export const POSITION_APPROXIMATE_METRES = 50;
// Bounds and coordinates are WGS84 longitude/latitude, including the edges.
export function isInBounds([longitude, latitude], [[west, south], [east, north]]) {
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
// An outside fix wins over age and accuracy; it must never recenter the local map.
export function classifyFix(fix, nowMilliseconds, bounds) {
  if (!isInBounds(fix.coordinates, bounds)) return 'outside';
  if (nowMilliseconds - fix.timestamp > POSITION_FRESH_MILLISECONDS) return 'stale';
  return fix.accuracy > POSITION_APPROXIMATE_METRES ? 'approximate' : 'live';
}
// Ground-scaled accuracy ring as a polygon; an equirectangular offset is accurate enough at these radii.
export function accuracyCircle([longitude, latitude], radiusMetres, steps = 48) {
  const metresPerDegree = 111320;
  const latitudeRadiusDegrees = radiusMetres / metresPerDegree;
  const longitudeRadiusDegrees = latitudeRadiusDegrees / Math.cos((latitude * Math.PI) / 180);
  const ring = [];
  for (let index = 0; index <= steps; index++) {
    const angleRadians = (index / steps) * 2 * Math.PI;
    ring.push([
      longitude + longitudeRadiusDegrees * Math.cos(angleRadians),
      latitude + latitudeRadiusDegrees * Math.sin(angleRadians)
    ]);
  }
  return {type: 'Polygon', coordinates: [ring]};
}
export function formatPositionAge(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const secondsBeforeMinuteDisplay = 90;
  return seconds < secondsBeforeMinuteDisplay ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
