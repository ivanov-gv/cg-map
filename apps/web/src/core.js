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
// One app-owned search green. MapLibre paint values cannot read CSS variables, so the stylesheet mirrors this value.
export const SEARCH_HIGHLIGHT_COLOR = '#2e7d32';

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
// references describe the building itself. A query naming both is an address in either word order.
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
  const streetTerms = [
    ...new Set(streets.flatMap(street => normalizeSearchText(street).split(/\s+/)).filter(Boolean))
  ];
  return {
    address: normalizeSearchText(streets.join(' ')),
    number: normalizeSearchText(numbers.join(' ')),
    streetTerms,
    numberTerms: numbers.map(normalizeSearchText).filter(Boolean)
  };
}

// Normalise each reviewed label once, when labels load. An existing index is returned unchanged so callers never
// repeat that work when the view moves.
export function indexBuildingLabels(labels) {
  if (Array.isArray(labels)) return labels;
  return (labels?.features ?? []).map(feature => ({
    feature,
    search: buildingSearchText(feature.properties ?? {})
  }));
}

// Returns which part of the label matched a query word, or null when no word of this label starts with it.
// An exact number identifier wins over a street prefix so "lamela b" stays a building, not street "Bulevar".
function matchedWordSource(word, streetWords, numberWords) {
  if (numberWords.includes(word)) return 'number';
  if (streetWords.includes(word)) return 'street';
  if (numberWords.some(numberWord => numberWord.startsWith(word))) return 'number';
  if (streetWords.some(streetWord => streetWord.startsWith(word))) return 'street';
  return null;
}

// Returns the result kind for a matching building label, or null when any query word is unmatched here.
// Address wins when the query names a street, with or without a number attached to this building.
export function classifyBuildingMatch(feature, query, search = buildingSearchText(feature.properties ?? {})) {
  const needle = normalizeSearchText(query);
  if (!needle) return null;
  const streetWords = search.streetTerms.flatMap(term => term.split(/\s+/)).filter(Boolean);
  const numberWords = search.numberTerms.flatMap(term => term.split(/\s+/)).filter(Boolean);
  const wordSources = needle
    .split(/\s+/)
    .filter(Boolean)
    .map(word => matchedWordSource(word, streetWords, numberWords));
  if (wordSources.includes(null)) return null;
  return {kind: wordSources.includes('street') ? 'address' : 'building'};
}

// Row title for a building/address result, using only recorded address attributes.
export function buildingResultLabel(properties) {
  const number = properties.building_number ?? properties['addr:housenumber'];
  const street = properties['addr:street'];
  if (street && number) return `${street} ${number}`;
  if (street) return street;
  return number ? `Building ${number}` : 'Building';
}

// A street query uses the building rule: every word starts a word in the street name. A number is never a street word.
export function matchesStreetName(name, query) {
  const queryWords = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  const nameWords = normalizeSearchText(name).split(/\s+/).filter(Boolean);
  if (!queryWords.length || !nameWords.length) return false;
  return queryWords.every(queryWord => nameWords.some(nameWord => nameWord.startsWith(queryWord)));
}

// Rendered road segments and address labels both supply candidate points; a label may be a pre-built index entry.
function streetSourceCandidates(feature, name, layerId, isRoad) {
  if (typeof name !== 'string' || !name.trim()) return [];
  const {type, coordinates} = feature?.geometry ?? {};
  let points;
  if (type === 'Point') points = [coordinates];
  else if (type === 'LineString') points = coordinates;
  else if (type === 'MultiLineString') points = coordinates.flat();
  else points = [];
  return points
    .filter(point => Array.isArray(point) && point.length >= 2)
    .map(point => ({name: name.trim(), coordinates: point, layerId, isRoad, feature}));
}

function nearestStreetSource(sources, referencePoint) {
  return sources.reduce((nearest, source) => {
    if (!nearest) return source;
    if (!referencePoint) return nearest;
    return distanceKilometres(referencePoint, source.coordinates) <
      distanceKilometres(referencePoint, nearest.coordinates)
      ? source
      : nearest;
  }, null);
}

// One row per street name, even when many road segments and building labels carry it. Road features supply the card's
// source attributes; every source supplies the representative point used for ranking and reveal.
export function collectStreetCandidates({query = '', labels = [], roads = [], referencePoint = null}) {
  const byStreetName = new Map();
  const addSources = (features, nameFor, layerIdFor, isRoad) => {
    for (const entry of features) {
      const feature = entry?.feature ?? entry;
      for (const source of streetSourceCandidates(feature, nameFor(feature), layerIdFor(feature), isRoad)) {
        if (!matchesStreetName(source.name, query)) continue;
        const key = normalizeSearchText(source.name);
        if (!byStreetName.has(key)) byStreetName.set(key, []);
        byStreetName.get(key).push(source);
      }
    }
  };
  addSources(roads, feature => feature?.properties?.name, feature => feature?.layer?.id ?? null, true);
  addSources(indexBuildingLabels(labels), feature => feature?.properties?.['addr:street'], () => null, false);

  return [...byStreetName.entries()].map(([key, sources]) => {
    const nearest = nearestStreetSource(sources, referencePoint);
    const roadSources = sources.filter(source => source.isRoad);
    const representative = nearestStreetSource(roadSources.length ? roadSources : sources, referencePoint);
    const feature = representative.isRoad
      ? representative.feature
      : {
          type: 'Feature',
          properties: {name: representative.name},
          geometry: {type: 'Point', coordinates: [...representative.coordinates]}
        };
    return {
      kind: 'street',
      id: `street/${key.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      name: representative.name,
      streetName: representative.name,
      label: representative.name,
      feature,
      coordinates: [...nearest.coordinates],
      layerId: representative.isRoad ? representative.layerId : null
    };
  });
}

// Collect every candidate once. Places supplied here already satisfy the active query and category; the app keeps
// that filtered set so a camera move never matches the same listings twice. Labels can be a pre-built index.
export function collectSearchResults({
  places = [],
  buildingLabels = [],
  roads = [],
  query = '',
  category = null,
  markerKeys = new Map(),
  referencePoint = null
}) {
  const results = places.map(feature => ({
    kind: 'place',
    id: feature.properties.id,
    markerKey: markerKeys.get(feature.properties.id) ?? String(feature.properties.id),
    feature,
    coordinates: feature.geometry.coordinates
  }));
  if (category !== null || !normalizeSearchText(query)) return results;
  for (const {feature, search} of indexBuildingLabels(buildingLabels)) {
    const match = classifyBuildingMatch(feature, query, search);
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
  results.push(...collectStreetCandidates({query, labels: buildingLabels, roads, referencePoint}));
  return results;
}

// Only distance changes when the camera or usable fix moves, so ranking stays separate from candidate collection.
// The centre still orders rows without a fix, but it must never be presented as the person's location.
export function rankSearchResults(results, center, {limit = 40, origin = null} = {}) {
  const rankOrigin = origin ?? center;
  return results
    .map(result => {
      const kilometres = distanceKilometres(rankOrigin, result.coordinates);
      return {
        ...result,
        distanceKilometres: kilometres,
        distanceText: origin ? formatDistance(kilometres) : ''
      };
    })
    .sort((first, second) => first.distanceKilometres - second.distanceKilometres)
    .slice(0, limit);
}

// Pure convenience for callers that hold unfiltered places and a raw label collection.
export function selectSearchResults({
  places = [],
  buildingLabels = [],
  roads = [],
  query = '',
  category = null,
  center,
  origin = null,
  referencePoint = null,
  markerKeys = new Map(),
  limit = 40
}) {
  const matchingPlaces = places.filter(feature => matchesPlaceSearch(feature, query, category));
  const candidates = collectSearchResults({
    places: matchingPlaces,
    buildingLabels,
    roads,
    query,
    category,
    markerKeys,
    referencePoint
  });
  return rankSearchResults(candidates, center, {origin, limit});
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

// Row text uses metres nearby and one decimal kilometre farther out; it is never a route length.
export function formatDistance(kilometres) {
  if (kilometres < 1) return `${Math.round(kilometres * 1000)} m`;
  return `${kilometres.toFixed(1)} km`;
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
// States with a fix good enough to centre the map on or measure distances from.
export const USABLE_POSITION_STATES = ['live', 'approximate'];
export function hasUsablePosition(state) {
  return USABLE_POSITION_STATES.includes(state);
}
// Only a fresh or approximate in-map fix may stand in for the person. Every other state keeps centre ordering
// without distance text, including a stale fix that still has coordinates.
export function distanceOrigin(snapshot) {
  const {state, fix} = snapshot ?? {};
  return hasUsablePosition(state) && fix?.coordinates ? fix.coordinates : null;
}
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
