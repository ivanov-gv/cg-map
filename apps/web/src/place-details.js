// Render listing content without owning selection, camera movement or focus restoration.
import {placeColors} from '@ivanov-gv/map-core';
import {safeWebsite} from './core.js';
import {createElement, elementById} from './dom.js';

// Details and external links use only recorded source fields and safe HTTP URLs.
export function renderPlaceDetails(feature) {
  const properties = feature.properties;
  const details = elementById('place-details');
  details.replaceChildren();
  const add = text => {
    if (text) details.append(createElement('p', text, 'detail'));
  };
  add(properties['name:en'] && properties['name:en'] !== properties.name ? properties['name:en'] : '');
  add([properties['addr:street'], properties['addr:housenumber']].filter(Boolean).join(' '));
  add(properties.kind?.replaceAll('_', ' '));
  add(properties.opening_hours ? 'OSM hours: ' + properties.opening_hours : '');
  add(properties.phone);
  add(
    feature.geometry.coordinates
      .slice()
      .reverse()
      .map(coordinate => coordinate.toFixed(5))
      .join(', ')
  );
  details.append(
    createElement('p', 'OpenStreetMap listing. Details may be incomplete or out of date.', 'source-note')
  );
  function link(text, url) {
    const linkElement = createElement('a', text);
    linkElement.href = url;
    linkElement.target = '_blank';
    linkElement.rel = 'noopener noreferrer';
    details.append(linkElement);
  }
  const website = safeWebsite(properties.website);
  if (website) link('Website ↗', website);
  if (/^(node|way)\/\d+$/.test(properties.id))
    link('View source ↗', 'https://www.openstreetmap.org/' + properties.id);
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
    const button = listingButton(result.feature, () => onChoose(result, button), result.distanceText, {
      kind: result.kind,
      id: result.id,
      label: result.label
    });
    if (currentId === String(result.id)) button.setAttribute('aria-current', 'true');
    list.append(button);
  }
}
