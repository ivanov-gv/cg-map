// The details card's and results list's content. These functions only build DOM; app.js owns what is selected.
import {placeColors} from '@ivanov-gv/map-core';
import {categories, formatCoordinates, safeWebsite} from './core.js';
import {createElement, elementById} from './dom.js';

const osmIdentity = /^(node|way)\/\d+$/;
const readableKind = kind => (kind ?? '').replaceAll('_', ' ');

export function setCardHeading(title, subtitle) {
  elementById('place-name').textContent = title;
  elementById('place-category').textContent = subtitle;
}

function appendDetailLines(container, lines) {
  for (const line of lines) {
    if (line) container.append(createElement('p', line, 'detail'));
  }
}

function appendExternalLink(container, text, url) {
  const link = createElement('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  container.append(link);
}

// Each line is shown only when the listing has it; the coordinates always close the list.
function placeDetailLines(place) {
  const properties = place.properties;
  const englishName = properties['name:en'] !== properties.name ? properties['name:en'] : '';
  const streetAddress = [properties['addr:street'], properties['addr:housenumber']].filter(Boolean).join(' ');
  return [
    englishName,
    streetAddress,
    readableKind(properties.kind),
    properties.opening_hours ? 'OSM hours: ' + properties.opening_hours : '',
    properties.phone,
    formatCoordinates(place.geometry.coordinates)
  ];
}

// A directory listing, with its source note and only links that are safe to open.
export function renderPlaceCard(place) {
  const properties = place.properties;
  setCardHeading(properties.name, categories[properties.category] ?? properties.category);
  const details = elementById('place-details');
  details.replaceChildren();
  appendDetailLines(details, placeDetailLines(place));
  details.append(createElement('p', 'OpenStreetMap listing. Details may be incomplete or out of date.', 'source-note'));
  const website = safeWebsite(properties.website);
  if (website) appendExternalLink(details, 'Website ↗', website);
  if (osmIdentity.test(properties.id)) appendExternalLink(details, 'View source ↗', 'https://www.openstreetmap.org/' + properties.id);
}

// A map point from point-selection.js: {name, kind, details, coordinates}.
export function renderPointCard(point) {
  setCardHeading(point.name, point.kind);
  const details = elementById('place-details');
  details.replaceChildren();
  appendDetailLines(details, [...point.details, formatCoordinates(point.coordinates)]);
}

// Several listings under one tap. Returns the list, whose first button should take focus.
export function renderListingChooser(listings, onChoose) {
  setCardHeading(`${listings.length} places here`, 'Choose a listing');
  const list = createElement('div', undefined, 'place-chooser');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Listings at this point');
  for (const place of listings) list.append(listingButton(place, () => onChoose(place)));
  elementById('place-details').replaceChildren(list);
  return list;
}

// One result row. Its symbol is '+' for essentials and the kind's initial otherwise, in the category's colour.
export function listingButton(place, onClick, distanceText) {
  const properties = place.properties;
  const button = createElement('button', undefined, 'result');
  button.type = 'button';
  button.dataset.id = properties.id;
  const symbolText = properties.category === 'essentials' ? '+' : (properties.kind ?? properties.category)[0].toUpperCase();
  const symbol = createElement('span', symbolText, 'symbol');
  symbol.style.setProperty('--color', placeColors[properties.category]);
  symbol.setAttribute('aria-hidden', 'true');
  const copy = createElement('span', undefined, 'copy');
  copy.append(createElement('strong', properties.name), createElement('small', readableKind(properties.kind)));
  button.append(symbol, copy);
  if (distanceText) button.append(createElement('span', distanceText, 'distance'));
  button.addEventListener('click', onClick);
  return button;
}
