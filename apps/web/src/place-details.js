// Render listing content without owning selection, camera movement or focus restoration.
import {placeColors} from '@ivanov-gv/map-core';
import {categories, formatDistance, safeWebsite} from './core.js';
import {createElement, elementById} from './dom.js';

const weekdayNames = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday'
};
const weekdayOrder = Object.keys(weekdayNames);
export const maximumNearbyPlaces = 3;
const maximumNearbyDistanceKilometres = 0.5;

// Display WGS84 as latitude first, with hemispheres; inputs stay [longitude, latitude].
export function formatCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite))
    return '';
  const [longitude, latitude] = coordinates;
  const latitudeText = `${Math.abs(latitude).toFixed(5)}° ${latitude < 0 ? 'S' : 'N'}`;
  const longitudeText = `${Math.abs(longitude).toFixed(5)}° ${longitude < 0 ? 'W' : 'E'}`;
  return `${latitudeText}, ${longitudeText}`;
}

// An unparseable rule makes the whole expression unsafe to summarize, so callers show the raw value.
function weekdayLabel(dayPart) {
  const range = /^([A-Za-z]{2})-([A-Za-z]{2})$/.exec(dayPart);
  if (range) {
    const firstIndex = weekdayOrder.indexOf(range[1]);
    const lastIndex = weekdayOrder.indexOf(range[2]);
    if (firstIndex < 0 || lastIndex < firstIndex) return null;
    return `${weekdayNames[range[1]]} – ${weekdayNames[range[2]]}`;
  }
  const days = dayPart.split(',');
  if (days.some(day => !weekdayNames[day])) return null;
  return days.map(day => weekdayNames[day]).join(', ');
}

export function openingHourRows(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const rows = [];
  for (const rule of value.split(';').map(ruleText => ruleText.trim()).filter(Boolean)) {
    const [dayPart, timePart, ...extra] = rule.split(/\s+/);
    const label = weekdayLabel(dayPart);
    const isTimeRange = /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(timePart ?? '');
    if (!label || !isTimeRange || extra.length) return [{label: '', value}];
    rows.push({label, value: timePart.replace('-', '–')});
  }
  return rows;
}

function formatSourceDate(value) {
  if (!value) return '';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsedDate);
}

function sourceLine(source, sourceDate, hasHours) {
  if (!source) return '';
  const snapshot = formatSourceDate(sourceDate);
  const prefix = `Source: ${source}${snapshot ? `, snapshot ${snapshot}` : ''}.`;
  return hasHours ? `${prefix} Hours are as recorded, not checked.` : prefix;
}

function humanizeKind(kind) {
  const text = String(kind ?? '').replaceAll('_', ' ').trim();
  if (!text) return '';
  if (text.toLowerCase() === 'cafe') return 'Café';
  return text[0].toUpperCase() + text.slice(1);
}

function streetAddress(properties) {
  return [properties['addr:street'], properties['addr:housenumber']].filter(Boolean).join(' ');
}

function detailRow(label, value, key) {
  return key ? {label, value, key} : {label, value};
}

function detailsSection(id, heading, rows = [], links = []) {
  return {id, heading, rows, links};
}

function addIfPresent(rows, label, value, key) {
  if (value) rows.push(detailRow(label, value, key));
}

function sourceLinks(properties) {
  const links = [];
  const website = safeWebsite(properties.website);
  if (website) links.push({text: 'Website ↗', url: website});
  if (/^(node|way)\/\d+$/.test(properties.id ?? ''))
    links.push({text: 'View source ↗', url: 'https://www.openstreetmap.org/' + properties.id});
  return links;
}

// Nearby context uses already loaded directory entries and the same distance rounding as result rows.
function nearbyRows(nearbyPlaces) {
  const rows = [];
  for (const candidate of nearbyPlaces ?? []) {
    const {distanceKilometres} = candidate;
    if (!Number.isFinite(distanceKilometres) || distanceKilometres > maximumNearbyDistanceKilometres) continue;
    const properties = candidate.feature?.properties ?? {};
    const categoryLabel = categories[properties.category] ?? humanizeKind(properties.kind ?? properties.category);
    if (!properties.name || !categoryLabel) continue;
    rows.push(detailRow('', `${properties.name} · ${categoryLabel} · ${formatDistance(distanceKilometres)}`));
  }
  return rows;
}

// A POI card contains only fields recorded for that place, plus the containing building when known.
export function buildPlaceCard(feature, context = {}) {
  const properties = feature?.properties ?? {};
  const categoryLabel = categories[properties.category] ?? humanizeKind(properties.category ?? properties.kind);
  const kindLabel = humanizeKind(properties.kind ?? properties.category);
  const address = streetAddress(properties);
  const location = detailsSection('location-and-contacts', 'Location and contacts');
  addIfPresent(location.rows, 'Address', address);
  addIfPresent(location.rows, 'In the building at', context.buildingAddress, 'building-address');
  addIfPresent(location.rows, 'Coordinates', formatCoordinates(feature?.geometry?.coordinates), 'coordinates');
  addIfPresent(location.rows, 'Phone', properties.phone);
  location.links.push(...sourceLinks(properties));
  const hours = detailsSection('opening-hours', 'Opening hours', openingHourRows(properties.opening_hours));
  const nearby = detailsSection('nearby', 'NEARBY', nearbyRows(context.nearbyPlaces));
  return {
    eyebrow: categoryLabel,
    title: properties.name ?? '',
    subtitle: [kindLabel, address].filter(Boolean).join(' · '),
    source: sourceLine(properties.source ?? 'OpenStreetMap', context.sourceDate, Boolean(properties.opening_hours)),
    sections: [location, hours, nearby].filter(section => section.rows.length || section.links.length)
  };
}

// Keep weekday labels with their hours; an unsupported expression stays raw instead of losing its days.
function readableHours(value) {
  const rows = openingHourRows(value);
  if (!rows.length) return '';
  if (rows.some(row => !row.label)) return value;
  return rows.map(row => `${row.label} ${row.value}`).join(', ');
}

function enclosedPlacesRows(places) {
  return places.map(place => {
    const properties = place.properties ?? {};
    const value = [properties.name, humanizeKind(properties.kind), readableHours(properties.opening_hours)]
      .filter(Boolean)
      .join(' · ');
    return detailRow('', value);
  });
}

// Other map objects use the same card with only the sections their recorded attributes fill.
export function buildObjectCard(point, context = {}) {
  const facts = point.facts ?? {};
  const isBuilding = facts.kind === 'Building';
  const coordinates = formatCoordinates(point.coordinates);
  if (isBuilding) return buildBuildingCard(point, facts, coordinates, context);
  const details = detailsSection('details', 'Details');
  for (const row of facts.detailRows ?? []) addIfPresent(details.rows, row.label, row.value);
  addIfPresent(details.rows, 'Type', facts.typeLabel ?? point.kind);
  addIfPresent(details.rows, 'Coordinates', coordinates);
  return {
    eyebrow: point.kind,
    title: point.name,
    subtitle: [facts.typeLabel, facts.addressLine].filter(Boolean).join(' · '),
    source: facts.source ? sourceLine(facts.source, facts.sourceDate ?? context.sourceDate, false) : '',
    sections: details.rows.length ? [details] : []
  };
}

function buildBuildingCard(point, facts, coordinates, context) {
  const properties = facts.properties ?? {};
  const addresses = facts.addresses ?? [];
  const entrances = facts.entrances ?? [];
  const placesInside = context.placesInside ?? [];
  const sections = [];
  if (addresses.length)
    sections.push(detailsSection('addresses', 'Addresses', addresses.map(address => detailRow('', address))));
  if (entrances.length)
    sections.push(
      detailsSection(
        'entrances',
        'Entrances (marked on the map)',
        entrances.map(entrance => detailRow('', `${entrance.label ?? ''} · ${entrance.address ?? ''}`.trim()))
      )
    );
  if (placesInside.length)
    sections.push(detailsSection('inside-this-building', 'Inside this building', enclosedPlacesRows(placesInside)));
  const details = detailsSection('details', 'Details');
  addIfPresent(details.rows, 'Type', facts.typeLabel ?? 'building');
  addIfPresent(details.rows, 'Coordinates', coordinates);
  sections.push(details);
  const addressCount = addresses.length
    ? `${addresses.length} recorded address${addresses.length === 1 ? '' : 'es'}`
    : '';
  const levels = properties['building:levels'] ? `${properties['building:levels']} levels` : '';
  return {
    eyebrow: 'Building',
    title: point.name || 'Unnamed building',
    subtitle: [humanizeKind(properties.building).replace(/^Building$/, ''), levels, addressCount]
      .filter(Boolean)
      .join(' · '),
    source: facts.source ? sourceLine(facts.source, facts.sourceDate ?? context.sourceDate, false) : '',
    sections
  };
}

function createDetailRow(row) {
  const line = createElement('p', undefined, 'detail-row');
  if (row.key) line.dataset.detail = row.key;
  line.append(createElement('span', row.label ? `${row.label}: ` : undefined, 'detail-label'));
  line.append(createElement('span', row.value, 'detail-value'));
  return line;
}

function appendDetailRows(container, rows) {
  for (const row of rows) container.append(createDetailRow(row));
}

function appendDetailLinks(container, links) {
  for (const link of links) {
    const element = createElement('a', link.text);
    element.href = link.url;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    container.append(element);
  }
}

// Sets the stable header/source/section elements; callers own focus and map selection.
export function renderCardContent(card) {
  elementById('place-name').textContent = card.title ?? '';
  elementById('place-category').textContent = card.eyebrow ?? '';
  const subtitle = elementById('place-subtitle');
  subtitle.textContent = card.subtitle ?? '';
  const source = elementById('place-source');
  source.textContent = card.source ?? '';
  source.hidden = !source.textContent;
  const details = elementById('place-details');
  details.replaceChildren();
  for (const section of card.sections ?? []) {
    const element = createElement('section', undefined, `details-section details-section--${section.id}`);
    element.append(createElement('h2', section.heading, 'section-title'));
    appendDetailRows(element, section.rows);
    appendDetailLinks(element, section.links);
    details.append(element);
  }
}

// A late building lookup adds one row; it never rebuilds the card or moves focus from an open link.
export function setPlaceCardBuildingAddress(address) {
  const location = elementById('place-details').querySelector('.details-section--location-and-contacts');
  if (!location) return;
  const existing = location.querySelector('[data-detail="building-address"]');
  if (existing) {
    existing.querySelector('.detail-value').textContent = address;
    return;
  }
  const row = createDetailRow(detailRow('In the building at', address, 'building-address'));
  const coordinates = location.querySelector('[data-detail="coordinates"]');
  if (coordinates) location.insertBefore(row, coordinates);
  else location.append(row);
}

export function clearCardContent() {
  for (const id of ['place-name', 'place-category', 'place-subtitle', 'place-source']) {
    elementById(id).textContent = '';
  }
  elementById('place-source').hidden = true;
  elementById('place-details').replaceChildren();
}

// The symbol carries the result kind, not just the category: a building or address is not a place listing.
const kindSymbols = {building: '🏢', address: '📍', street: '🛣'};
const kindLabels = {building: 'Building', address: 'Address', street: 'Street'};

export function listingButton(place, onClick, distanceText, {kind = 'place', id = null, label = null} = {}) {
  const properties = place.properties;
  const button = createElement('button', undefined, 'result');
  button.type = 'button';
  button.dataset.id = id ?? properties.id;
  button.dataset.kind = kind;
  const isPlace = kind === 'place';
  const glyph = isPlace
    ? properties.category === 'essentials'
      ? '+'
      : (properties.kind ?? properties.category)[0].toUpperCase()
    : kindSymbols[kind];
  const symbol = createElement('span', glyph, 'symbol');
  // Building and address rows take --search-highlight from the stylesheet; only places carry a category colour.
  if (isPlace) symbol.style.setProperty('--color', placeColors[properties.category]);
  symbol.setAttribute('aria-hidden', 'true');
  const copy = createElement('span', undefined, 'copy');
  copy.append(
    createElement('strong', label ?? properties.name),
    createElement('small', isPlace ? (properties.kind ?? '').replaceAll('_', ' ') : kindLabels[kind])
  );
  button.append(symbol, copy);
  if (distanceText) button.append(createElement('span', distanceText, 'distance'));
  button.addEventListener('click', onClick);
  return button;
}

// Row identity survives rebuilding so keyboard focus stays on the listing that opened the card.
export function renderPlaceResults({results, currentId, loadingError, onChoose}) {
  const list = elementById('results');
  const focusedPlaceId = list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  buildPlaceResults(list, {results, currentId: String(currentId ?? ''), loadingError, onChoose});
  if (!focusedPlaceId) return;
  const replacementRow = [...list.children].find(row => row.dataset.id === focusedPlaceId);
  replacementRow?.focus({preventScroll: true});
}

// A directory failure is never presented as an empty search; only complete data yields listing rows.
function buildPlaceResults(list, {results, currentId, loadingError, onChoose}) {
  list.replaceChildren();
  if (loadingError) {
    list.append(createElement('p', `Places could not load (${loadingError}). Reload to try again.`, 'empty'));
    return;
  }
  if (results.length === 0) {
    list.append(createElement('p', 'No places found. Try another search or category.', 'empty'));
    return;
  }
  for (const result of results) {
    // The origin-aware text is prepared by ranking; without a usable fix there is no distance to show.
    const button = listingButton(result.feature, () => onChoose(result, button), result.distanceText, {
      kind: result.kind,
      id: result.id,
      label: result.label
    });
    if (currentId === String(result.id)) button.setAttribute('aria-current', 'true');
    list.append(button);
  }
}
