// Pure policy for the public app: search, distances, Discover scale and location states. No DOM, storage or network.
// Coordinates are WGS84 [longitude, latitude].

export const categories = {
  all: 'Explore all',
  food: 'Eat & drink',
  sights: 'See & do',
  shops: 'Shops',
  stay: 'Stay',
  essentials: 'Essentials'
};

// Serbian Cyrillic letters to the Latin spelling people type; a few Russian letters are covered for visitors.
// ђ is handled before this table, because Latin đ folds to the same "dj".
const latinForCyrillic = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'z', з: 'z', и: 'i', ј: 'j', к: 'k', л: 'l', љ: 'lj', м: 'm',
  н: 'n', њ: 'nj', о: 'o', п: 'p', р: 'r', с: 's', т: 't', ћ: 'c', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'c', џ: 'dz',
  ш: 's', й: 'i', ы: 'y', ь: '', ъ: '', я: 'ya', ю: 'yu', щ: 'sh', э: 'e'
};
const combiningDiacritics = /[̀-ͯ]/g;
const cyrillicLetters = /[а-яјљњћџ]/g;

// Lower-case Latin text without diacritics, so "Njegoševa", "Његошева" and "njegoseva" all compare equal.
export function foldForSearch(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(combiningDiacritics, '')
    .replace(/ђ|đ/g, 'dj')
    .replace(cyrillicLetters, letter => latinForCyrillic[letter] ?? letter)
    .trim();
}

// Whether a place is in the category ('all' admits every place) and its names, kind or street contain the query.
export function matchesSearch(place, query, category) {
  const properties = place.properties;
  const isInCategory = category === 'all' || properties.category === category;
  const searchableText = [properties.name, properties['name:en'], properties.kind, properties['addr:street']].join(' ');
  return isInCategory && foldForSearch(searchableText).includes(foldForSearch(query));
}

const radiansPerDegree = Math.PI / 180;
const kilometresPerDegreeOfLatitude = 111.2;

// Equirectangular approximation: accurate enough for distances within Montenegro.
export function distanceKilometres(from, to) {
  const meanLatitude = ((from[1] + to[1]) / 2) * radiansPerDegree;
  const eastDegrees = (from[0] - to[0]) * Math.cos(meanLatitude);
  const northDegrees = from[1] - to[1];
  return Math.hypot(eastDegrees, northDegrees) * kilometresPerDegreeOfLatitude;
}

// Returns an absolute http(s) URL, or null for anything a link must not open, such as javascript: or data: URLs.
export function safeWebsite(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// The closest places first, each with its distance from center.
export function nearestPlaces(places, center, limit = 40) {
  return places
    .map(place => ({place, distanceKilometres: distanceKilometres(center, place.geometry.coordinates)}))
    .sort((first, second) => first.distanceKilometres - second.distanceKilometres)
    .slice(0, limit);
}

export function featureCollection(features) {
  return {type: 'FeatureCollection', features};
}

const bytesPerMegabyte = 1048576;

export function formatBytes(bytes) {
  return `${(bytes / bytesPerMegabyte).toFixed(1)} MB`;
}

const metresPerKilometre = 1000;

// Whole metres below one kilometre, then kilometres with one decimal.
export function formatDistance(metres) {
  if (metres < metresPerKilometre) return `${Math.round(metres)} m`;
  return `${(metres / metresPerKilometre).toFixed(1)} km`;
}

// Five decimals locate a point to about a metre.
const coordinateDecimals = 5;

// "latitude, longitude": the order people read and paste into other maps.
export function formatCoordinates([longitude, latitude]) {
  return [latitude, longitude].map(value => value.toFixed(coordinateDecimals)).join(', ');
}

// Discover scale policy (docs/ui-ux/discover.md). Scale is ground metres per CSS pixel; MapLibre uses 512px tiles.
const earthCircumferenceMetres = 40075016.686;
const tileSizePixels = 512;

export function metresPerPixel(latitude, zoom) {
  return (earthCircumferenceMetres * Math.cos(latitude * radiansPerDegree)) / (tileSizePixels * 2 ** zoom);
}

export function zoomForMetresPerPixel(latitude, metres) {
  return Math.log2((earthCircumferenceMetres * Math.cos(latitude * radiansPerDegree)) / (tileSizePixels * metres));
}

export const DEFAULT_CENTER = [19.26, 42.437];
// About 1 ground metre per CSS pixel over central Podgorica, rounded to one decimal.
export const DISCOVER_ZOOM = Math.round(zoomForMetresPerPixel(DEFAULT_CENTER[1], 1) * 10) / 10;

// Location display states (D-06). Thresholds are the proposed initial tuning, not validated release values.
export const POSITION_FRESH_MILLISECONDS = 30000;
export const POSITION_TIMEOUT_MILLISECONDS = 15000;
export const POSITION_APPROXIMATE_METRES = 50;

function isInBounds([longitude, latitude], [[west, south], [east, north]]) {
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}

// Returns 'outside', 'stale', 'approximate' or 'live' for a fix at time now, in milliseconds.
export function classifyFix(fix, now, bounds) {
  if (!isInBounds(fix.coordinates, bounds)) return 'outside';
  if (now - fix.timestamp > POSITION_FRESH_MILLISECONDS) return 'stale';
  return fix.accuracy > POSITION_APPROXIMATE_METRES ? 'approximate' : 'live';
}

const metresPerDegreeOfLatitude = 111320;

// Ground-scaled accuracy ring as a closed polygon; an equirectangular offset is accurate enough at these radii.
export function accuracyCircle([longitude, latitude], radiusMetres, steps = 48) {
  const latitudeRadius = radiusMetres / metresPerDegreeOfLatitude;
  const longitudeRadius = latitudeRadius / Math.cos(latitude * radiansPerDegree);
  const ring = [];
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * 2 * Math.PI;
    ring.push([longitude + longitudeRadius * Math.cos(angle), latitude + latitudeRadius * Math.sin(angle)]);
  }
  return {type: 'Polygon', coordinates: [ring]};
}

const secondsShownBeforeMinutes = 90;

// Seconds up to a minute and a half, then whole minutes.
export function formatAge(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < secondsShownBeforeMinutes ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}
