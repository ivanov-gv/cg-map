export const categories = {
  all: 'Explore all',
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
export const fold = text =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ђ|đ/g, 'dj')
    .replace(/[а-яјљњћџ]/g, character => cyrillicTransliteration[character] ?? character)
    .trim();
// Search combines category eligibility with the listing's searchable text.
export function matches(feature, query, category) {
  const properties = feature.properties;
  const matchesCategory = category === 'all' || properties.category === category;
  const searchableText = [
    properties.name,
    properties['name:en'],
    properties.kind,
    properties['addr:street']
  ].join(' ');
  return matchesCategory && fold(searchableText).includes(fold(query));
}

// Approximate ground distance in kilometres, suitable for ordering nearby results.
export function distance(first, second) {
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
export function selectNearest(features, center, limit = 40) {
  return features
    .map(feature => ({feature, distanceKilometres: distance(center, feature.geometry.coordinates)}))
    .sort((first, second) => first.distanceKilometres - second.distanceKilometres)
    .slice(0, limit);
}
export const collection = features => ({type: 'FeatureCollection', features});
export const formatBytes = bytes => `${(bytes / 1048576).toFixed(1)} MB`;
// Discover scale policy (docs/ui-ux/user-stories/discover.md). Scale is ground metres per CSS pixel; MapLibre uses 512px tiles.
const EARTH_CIRCUMFERENCE = 40075016.686;
export const metersPerPixel = (latitude, zoom) =>
  (EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
export const zoomForMetersPerPixel = (latitude, metresPerPixel) =>
  Math.log2((EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) / (512 * metresPerPixel));
export const DEFAULT_CENTER = [19.26, 42.437];
// About 1 ground metre per CSS pixel over central Podgorica.
export const DISCOVER_ZOOM = Math.round(zoomForMetersPerPixel(DEFAULT_CENTER[1], 1) * 10) / 10;
// Location display states (D-06). Thresholds are the proposed initial tuning, not validated release values.
export const POSITION_FRESH_MS = 30000;
export const POSITION_TIMEOUT_MS = 15000;
export const POSITION_APPROXIMATE_M = 50;
// Bounds and coordinates are WGS84 longitude/latitude, including the edges.
export function inBounds([longitude, latitude], [[west, south], [east, north]]) {
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
// An outside fix wins over age and accuracy; it must never recenter the local map.
export function classifyFix(fix, now, bounds) {
  if (!inBounds(fix.coordinates, bounds)) return 'outside';
  if (now - fix.timestamp > POSITION_FRESH_MS) return 'stale';
  return fix.accuracy > POSITION_APPROXIMATE_M ? 'approximate' : 'live';
}
// Ground-scaled accuracy ring as a polygon; an equirectangular offset is accurate enough at these radii.
export function accuracyCircle([longitude, latitude], radius, steps = 48) {
  const metresPerDegree = 111320;
  const latitudeRadiusDegrees = radius / metresPerDegree;
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
export function formatAge(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  const secondsBeforeMinuteDisplay = 90;
  return seconds < secondsBeforeMinuteDisplay ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
