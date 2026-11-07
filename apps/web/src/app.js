import {
  categories,
  matches,
  selectNearest,
  safeWebsite,
  collection,
  DEFAULT_CENTER,
  DISCOVER_ZOOM,
  POSITION_APPROXIMATE_M,
  formatAge
} from './core.js';
import {
  createMap,
  registerArchiveProtocol,
  mapBounds,
  setSatelliteVisible,
  satelliteBounds,
  placeColors,
  installPlaceIcons,
  parseVisibilityConfig,
  normalizePlaces,
  markerKeys,
  placeBands,
  buildPlaceMarkers,
  requestedPlaceMarker,
  placeLayers,
  listingsAtHits
} from '@ivanov-gv/map-core';
import {ArchiveSource, downloadLabel} from './offline.js';
import {installTransport, TransportFeed} from './transport.js';
import {
  describePoint,
  buildingAddressIndex,
  buildingMapFeatures,
  entranceFeatures,
  installEntranceLayers,
  selectBuildingEntrances,
  endpointFeatures,
  installRoutePoints
} from './point-selection.js';
import {RoutePlanner} from './route-planner.js';
import {ObjectSelection} from './object-selection.js';
import {registerAppUpdates} from './app-updates.js';
import {resolveDataMode, dataEndpoints, basemapURL} from './data-mode.js';
import {installMapTaps} from './map-taps.js';
import {PositionTracker, positionFeatures, installPositionLayers} from './position.js';
import {MapInterface, isInFocusZone} from './interface.js';
const elementById = id => document.getElementById(id);
let map;
let allPlaces = [];
let filteredPlaces = [];
let placesById = new Map();
let category = 'all';
let selectedPlace = null;
let archive;
let manifest;
let downloadAbort;
let returnFocus;
let satelliteVisible = false;
let transport;
let selectedPoint;
let routePlanner;
let objectSelection;
let dataMode;
let dataSources;
const endpoints = {from: null, to: null};
let loaded = false;
let errorTimer;
let searchTimer;
let serviceWorkerRegistration = null;
let buildingAddresses = new Map();
let placesError = null;
let position = {state: 'idle', fix: null, age: null};
let explored = false;
let ownMove = false;
let centeredOnFix = false;
let mapInterface;
let previewPlace = null;
let locationRequested = false;
let pendingReveal = null;
let choosing = false;
let visibilityConfig;
let markerKeysByPlaceId = new Map();
let placeHitLayers = ['search-place'];
let requestedMarkerKey = null;
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// config.json comes from the host: the Go server answers {"api":"server"}, static hosts serve the
// artifact's {"api":"mock"}. A missing file, an offline start or a server error falls back to the
// bundled data (a server error visibly). Other HTTP errors and invalid content stop startup.
async function loadDataMode() {
  let response = null;
  let config = null;
  try {
    response = await fetch('config.json', {cache: 'no-store'});
  } catch (error) {
    console.warn('config.json unreachable (offline start); using bundled data', error);
  }
  if (response?.ok) {
    try {
      config = await response.json();
    } catch (error) {
      throw new Error('Invalid config.json: ' + error.message, {cause: error});
    }
  } else if (response && response.status >= 500) {
    notify(
      `Server settings unavailable (HTTP ${response.status}). Showing preview data; live buses use the public relay.`
    );
  } else if (response && response.status !== 404)
    throw new Error('Could not load config.json: HTTP ' + response.status);
  return resolveDataMode(location.search, config);
}
function renderTransportStatus({state, count, fetchedAt}) {
  const checked = fetchedAt
    ? new Date(fetchedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'})
    : '';
  const labels = {
    off: 'Transport off',
    loading: 'Loading live buses…',
    live: count
      ? `${count} bus position${count === 1 ? '' : 's'} · checked ${checked}`
      : `No buses reported · checked ${checked}`,
    stale: `Updates delayed · last checked ${checked}`,
    unavailable: 'Live buses temporarily unavailable · retrying',
    offline: 'Live buses need an internet connection',
    paused: 'Bus updates paused while map is hidden'
  };
  elementById('transport-status').textContent = labels[state] ?? labels.unavailable;
  elementById('transport-status').dataset.state = state;
}
function notify(message) {
  elementById('error-text').textContent = message;
  elementById('error').hidden = false;
}
function createElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function syncPanels() {
  elementById('route-endpoints').hidden =
    (!endpoints.from && !endpoints.to) ||
    mapInterface?.view !== 'closed' ||
    !elementById('place-card').hidden;
}
function focusCoordinates(coordinates, zoom = 15, duration = 450) {
  if (!map) return;
  explored = true;
  map.easeTo({
    center: coordinates,
    zoom: Math.max(map.getZoom(), zoom),
    offset: mapInterface.mapOffset(),
    duration: prefersReducedMotion ? 0 : duration
  });
}
// Keep a chosen place visible with as little camera movement as possible: pan only when it leaves the focus zone.
function revealCoordinates(coordinates, {zoom = 15, duration = 450} = {}) {
  if (!map) return;
  explored = true;
  const needsZoom = map.getZoom() < zoom;
  if (!needsZoom && isInFocusZone(map.project(coordinates), mapInterface.mapArea())) return;
  map.easeTo({
    center: coordinates,
    zoom: Math.max(map.getZoom(), zoom),
    offset: mapInterface.mapOffset(),
    duration: prefersReducedMotion ? 0 : duration
  });
}
// The camera stays still while the keyboard is up; a pending reveal waits for the layout it leaves behind.
function flushPendingReveal() {
  const coordinates = pendingReveal?.coordinates ?? selectedPoint?.coordinates;
  if (!pendingReveal || !coordinates || mapInterface.keyboardOpen()) return;
  const options = pendingReveal;
  pendingReveal = null;
  revealCoordinates(coordinates, options);
}
const hasExplicitFilter = () => !!elementById('search').value.trim() || category !== 'all';
// Admission is fixed by each band's zoom range. Only the selected listing, or otherwise the leading explicit result,
// may also appear below its threshold.
function updatePlaceLayers() {
  if (!loaded || placesError) return;
  objectSelection.setPreview(
    selectedPlace || !previewPlace ? null : markerKeysByPlaceId.get(previewPlace.properties.id)
  );
  const {features, maxzoom} = requestedPlaceMarker(
    selectedPlace ?? previewPlace,
    filteredPlaces,
    markerKeysByPlaceId,
    visibilityConfig
  );
  const key = `${features[0]?.properties.activeIds}@${maxzoom}`;
  if (key === requestedMarkerKey) return;
  requestedMarkerKey = key;
  map.getSource('requested-place').setData(collection(features));
  map.setLayerZoomRange('search-place', 0, maxzoom);
}
function previewResults() {
  if (!loaded || placesError || mapInterface.view === 'closed' || !hasExplicitFilter()) return;
  previewPlace = selectNearest(filteredPlaces, map.getCenter().toArray(), 1)[0]?.feature ?? null;
  updatePlaceLayers();
  renderResults();
}
function setChoosing(active) {
  choosing = active;
  elementById('point-actions').hidden = active;
}
function closePlace(restoreFocus = true) {
  const hadPoint = !!selectedPoint || choosing;
  selectedPoint = null;
  selectedPlace = null;
  pendingReveal = null;
  setChoosing(false);
  elementById('place-card').hidden = true;
  mapInterface?.resetCardState();
  objectSelection?.clear();
  updatePlaceLayers();
  markCurrentResult();
  if (restoreFocus && returnFocus)
    mapInterface?.restoreFocus(
      returnFocus.isConnected && returnFocus.getClientRects().length ? returnFocus : elementById('search')
    );
  else if (restoreFocus && hadPoint) map?.getCanvas().focus({preventScroll: true});
  returnFocus = null;
  syncPanels();
}
function markCurrentResult() {
  const currentId = String((selectedPlace ?? previewPlace)?.properties.id);
  for (const row of elementById('results').querySelectorAll('.result')) {
    if (row.dataset.id === currentId) {
      row.setAttribute('aria-current', 'true');
      row.scrollIntoView({block: 'nearest'});
    } else row.removeAttribute('aria-current');
  }
}
// Requires a ready map and initialized selection layers; opens a known listing and defers camera
// framing until the keyboard is closed, preserving the originating control for focus restoration.
function showPlace(id, trigger) {
  const feature = placesById.get(String(id));
  if (!feature) return;
  setChoosing(false);
  selectedPlace = feature;
  selectedPoint = {name: feature.properties.name, coordinates: [...feature.geometry.coordinates]};
  returnFocus = trigger ?? null;
  const properties = feature.properties;
  elementById('place-name').textContent = properties.name;
  elementById('place-category').textContent = categories[properties.category] ?? properties.category;
  renderPlaceDetails(feature);
  previewPlace = null;
  updatePlaceLayers();
  elementById('search').blur();
  elementById('place-card').hidden = false;
  mapInterface.placeCardOpened();
  elementById('place-card').scrollTop = 0;
  syncPanels();
  markCurrentResult();
  objectSelection.selectPlace(feature, markerKeysByPlaceId.get(properties.id));
  elementById('close-place').focus({preventScroll: true});
  pendingReveal = {zoom: 15};
  flushPendingReveal();
}
// Details and external links use only recorded source fields and safe HTTP URLs.
function renderPlaceDetails(feature) {
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

// Keep every recorded entrance clear of the header and card, without zooming closer than the selected view.
function frameBuildingEntrances(entrances, coordinates) {
  const positions = [coordinates, ...entrances.map(entrance => entrance.coordinates)];
  const area = mapInterface.mapArea();
  const horizontalMarginPixels = Math.min(64, (area.right - area.left) / 4);
  const verticalMarginPixels = 32;
  const canvas = map.getCanvas();
  const bounds = new maplibregl.LngLatBounds();
  for (const position of positions) bounds.extend(position);
  const padding = {
    left: area.left + horizontalMarginPixels,
    right: canvas.clientWidth - area.right + horizontalMarginPixels,
    top: area.top + verticalMarginPixels,
    bottom: canvas.clientHeight - area.bottom + verticalMarginPixels
  };
  map.fitBounds(bounds, {
    padding,
    maxZoom: map.getZoom(),
    duration: prefersReducedMotion ? 0 : 450,
    retainPadding: false
  });
}

// Selection uses the existing details card and original footprint; entrance bounds keep the arrows visible.
function showPoint(point, feature = null) {
  closePlace(false);
  selectedPoint = point;
  elementById('place-name').textContent = point.name;
  elementById('place-category').textContent = point.kind;
  const details = elementById('place-details');
  details.replaceChildren();
  const coordinatesLine = point.coordinates
    .slice()
    .reverse()
    .map(coordinate => coordinate.toFixed(5))
    .join(', ');
  for (const text of [...point.details, coordinatesLine]) {
    if (text) details.append(createElement('p', text, 'detail'));
  }
  elementById('place-card').hidden = false;
  previewPlace = null;
  updatePlaceLayers();
  mapInterface.close();
  mapInterface.placeCardOpened();
  syncPanels();
  objectSelection.select(feature, point.coordinates);
  const footprintIndex =
    feature?.layer?.id === 'buildings' ? feature.id : feature?.properties?.footprintIndex;
  const entrances = point.kind === 'Building' ? buildingAddresses.get(footprintIndex)?.entrances : [];
  if (entrances?.length) {
    selectedPoint = {...point, entrances};
    frameBuildingEntrances(entrances, point.coordinates);
  } else focusCoordinates(point.coordinates, map.getZoom());
  elementById('close-place').focus({preventScroll: true});
}
// Several listings under one tap: same location, or nearby markers that overlap. Each stays a real listing.
function showChooser(listings, coordinates) {
  closePlace(false);
  setChoosing(true);
  elementById('place-name').textContent = `${listings.length} places here`;
  elementById('place-category').textContent = 'Choose a listing';
  const details = elementById('place-details');
  details.replaceChildren();
  const list = createElement('div', undefined, 'place-chooser');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Listings at this point');
  for (const feature of listings) list.append(listingButton(feature, () => showPlace(feature.properties.id)));
  details.append(list);
  elementById('search').blur();
  elementById('place-card').hidden = false;
  previewPlace = null;
  updatePlaceLayers();
  mapInterface.placeCardOpened();
  // The list must be usable at once, so a phone card opens full instead of as a header-only peek.
  if (mapInterface.view === 'search') mapInterface.setCardState('full');
  syncPanels();
  pendingReveal = {zoom: map.getZoom(), coordinates};
  flushPendingReveal();
  list.firstElementChild.focus({preventScroll: true});
}
function renderEndpoints() {
  for (const role of ['from', 'to']) {
    const point = endpoints[role];
    elementById('route-' + role).textContent = point
      ? `${point.name} · ${point.coordinates
          .slice()
          .reverse()
          .map(coordinate => coordinate.toFixed(5))
          .join(', ')}`
      : 'Not selected';
  }
  syncPanels();
  map.getSource('route-points').setData(endpointFeatures(endpoints));
  routePlanner?.setEndpoints(endpoints);
}
function setEndpoint(role) {
  if (!selectedPoint) return;
  endpoints[role] = {name: selectedPoint.name, coordinates: [...selectedPoint.coordinates]};
  // Route controls live on the map, so choosing an endpoint leaves search or the dock.
  mapInterface.close();
  renderEndpoints();
  closePlace();
}
function listingButton(place, onClick, distance) {
  const properties = place.properties;
  const button = createElement('button', undefined, 'result');
  button.type = 'button';
  button.dataset.id = properties.id;
  const symbol = createElement(
    'span',
    properties.category === 'essentials' ? '+' : (properties.kind ?? properties.category)[0].toUpperCase(),
    'symbol'
  );
  symbol.style.setProperty('--color', placeColors[properties.category]);
  symbol.setAttribute('aria-hidden', 'true');
  const copy = createElement('span', undefined, 'copy');
  copy.append(
    createElement('strong', properties.name),
    createElement('small', (properties.kind ?? '').replaceAll('_', ' '))
  );
  button.append(symbol, copy);
  if (distance) button.append(createElement('span', distance, 'distance'));
  button.addEventListener('click', onClick);
  return button;
}
function renderResults() {
  if (!map) return;
  // A failed load is an error state, never an empty search result.
  if (placesError) {
    elementById('results').replaceChildren(
      createElement('p', `Places could not load (${placesError}). Reload to try again.`, 'empty')
    );
    return;
  }
  const center = map.getCenter().toArray();
  const nearest = selectNearest(filteredPlaces, center);
  const list = elementById('results');
  list.replaceChildren();
  if (!nearest.length) {
    list.append(createElement('p', 'No places found. Try another search or category.', 'empty'));
    return;
  }
  for (const {feature, distanceKilometres} of nearest) {
    const button = listingButton(
      feature,
      () => showPlace(feature.properties.id, button),
      distanceKilometres < 1
        ? Math.round(distanceKilometres * 1000) + ' m'
        : distanceKilometres.toFixed(1) + ' km'
    );
    if ((selectedPlace ?? previewPlace)?.properties.id === feature.properties.id)
      button.setAttribute('aria-current', 'true');
    list.append(button);
  }
}
// A search or category narrows the candidates; matching icons keep their thresholds.
function filterPlaces() {
  filteredPlaces = allPlaces.filter(feature => matches(feature, elementById('search').value, category));
  if (loaded && !placesError)
    map.getSource('places').setData(collection(buildPlaceMarkers(filteredPlaces, markerKeysByPlaceId)));
  if (
    choosing ||
    (selectedPlace && !filteredPlaces.some(feature => feature.properties.id === selectedPlace.properties.id))
  )
    closePlace(false);
  previewPlace = null;
  updatePlaceLayers();
  renderResults();
  previewResults();
}
// Connection state only; it carries no location meaning. Online with no saved map needs no badge.
function updateConnection() {
  const saved = !!archive?.local;
  const text = !navigator.onLine
    ? saved
      ? 'Offline · saved map'
      : 'Offline · download needed'
    : saved
      ? 'Saved map in use'
      : '';
  elementById('connection').textContent = text;
  elementById('connection').hidden = !text;
}
// In server mode a download or removal during the session switches the basemap between the API and
// the verified local archive, so offline use never depends on uncached API tiles.
function refreshBasemap() {
  const source = map?.getSource('basemap');
  const url = basemapURL(dataSources, archive.url, !!archive.local);
  if (source && source.url !== url) source.setUrl(url);
}
function storageNote(message) {
  elementById('storage-note').textContent = message;
  elementById('storage-note').hidden = !message;
}
function updateDownload() {
  if (!manifest) return;
  refreshBasemap();
  const ready = !!archive?.local;
  elementById('download-title').textContent = ready
    ? 'Map saved for offline use'
    : 'Download for offline use';
  elementById('download').title = downloadLabel(manifest);
  elementById('download-state').textContent = ready ? 'READY' : '';
  elementById('download').disabled = ready || !archive?.directory || !serviceWorkerRegistration;
  elementById('remove-download').hidden = !ready;
  if (!archive?.directory)
    storageNote('Use HTTPS or localhost with a browser supporting local file storage to enable downloads.');
  updateConnection();
}
async function startDownload() {
  if (downloadAbort) return;
  downloadAbort = new AbortController();
  elementById('download').disabled = true;
  elementById('cancel-download').hidden = false;
  elementById('download-progress').hidden = false;
  elementById('error').hidden = true;
  try {
    await navigator.serviceWorker.ready;
    const result = await archive.download(downloadAbort.signal, (done, total) => {
      elementById('download-progress').value = (done / total) * 100;
      elementById('download-title').textContent =
        `Saving map… ${Math.min(100, Math.round((done / total) * 100))}%`;
    });
    storageNote(
      result.persisted
        ? 'Saved on this device. Ready for offline use.'
        : 'Saved. Your browser may remove downloads when storage is low.'
    );
  } catch (error) {
    if (error.name !== 'AbortError') notify(error.message);
    else storageNote('Download cancelled. Existing downloads remain available.');
  } finally {
    downloadAbort = null;
    elementById('cancel-download').hidden = true;
    elementById('download-progress').hidden = true;
    updateDownload();
  }
}
async function loadJSON(path, what) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${what}: invalid JSON`, {cause: error});
  }
}
// D-06: the status always names the location condition; without a fix the default camera is a fallback view.
let tracker;
function renderPosition(snapshot) {
  position = snapshot;
  const {state, fix, age} = snapshot;
  const fallback = explored || (fix && state !== 'outside') ? '' : ' · default view: Podgorica';
  const accuracy = fix ? `±${Math.round(fix.accuracy)} m` : '';
  const texts = {
    idle: 'Checking location…',
    insecure: 'Location needs a secure (HTTPS) page',
    unsupported: 'This browser cannot share location',
    prompt: 'Allow location to see where you are',
    acquiring: 'Finding your location…',
    live: `You are here · ${accuracy}`,
    approximate: `Approximate location · ${accuracy} (over ${POSITION_APPROXIMATE_M} m)`,
    stale: `Location not updating · last fix ${formatAge(age ?? 0)} ago`,
    denied: 'Location blocked in browser settings',
    unavailable: 'Location unavailable · check device settings',
    timeout: 'No location fix within 15 s',
    outside: 'You are outside the map (Montenegro)'
  };
  elementById('position-status').textContent =
    (texts[state] ?? texts.unavailable) + (['live', 'approximate', 'stale'].includes(state) ? '' : fallback);
  elementById('position-badge').dataset.state = state;
  const action = ['live', 'approximate'].includes(state) ? 'Recenter on your location' : 'Locate me';
  elementById('position-action').setAttribute(
    'aria-label',
    action + '. ' + elementById('position-status').textContent
  );
  elementById('position-action').title = elementById('position-status').textContent;
  elementById('position-indicator').textContent =
    {idle: '…', prompt: '?', acquiring: '…', approximate: '≈', stale: '◷', live: ''}[state] ?? '!';
  if (
    locationRequested &&
    ['denied', 'unavailable', 'timeout', 'outside', 'insecure', 'unsupported'].includes(state)
  ) {
    notify(texts[state]);
    locationRequested = false;
  }
  if (locationRequested && state === 'stale' && tracker?.error) {
    notify('Location is not updating. Check device location settings and try again.');
    locationRequested = false;
  }
  if (!map?.getSource('position')) return;
  map.getSource('position').setData(positionFeatures(snapshot));
  // Center once on the first usable fix, never after the person has started exploring.
  if (['live', 'approximate'].includes(state) && ((!centeredOnFix && !explored) || locationRequested)) {
    const offset = locationRequested ? mapInterface.mapOffset() : [0, 0];
    centeredOnFix = true;
    locationRequested = false;
    ownMove = true;
    map.easeTo({
      center: fix.coordinates,
      zoom: Math.max(map.getZoom(), DISCOVER_ZOOM),
      offset,
      duration: prefersReducedMotion ? 0 : 600
    });
  }
}
function positionAction() {
  mapInterface.close();
  closePlace(false);
  if (position.fix && ['live', 'approximate'].includes(position.state)) {
    focusCoordinates(position.fix.coordinates, DISCOVER_ZOOM, 500);
    return;
  }
  locationRequested = true;
  if (['denied', 'outside', 'insecure', 'unsupported'].includes(position.state)) {
    renderPosition(position);
    return;
  }
  tracker?.retry();
}
// Public startup owns location, offline transport and workflow state; core owns the map lifecycle.
async function start() {
  if (location.protocol === 'file:' || location.protocol === 'content:') {
    notify(
      'Open Kompas through the supplied local server or an HTTPS address. A downloaded HTML file cannot install the offline app.'
    );
    elementById('loading').hidden = true;
    return;
  }
  if (!globalThis.maplibregl || !globalThis.pmtiles) {
    notify('The bundled map libraries did not load. Check the application files.');
    return;
  }
  // Location, places and house numbers start immediately and never block the base map.
  tracker = new PositionTracker({bounds: mapBounds, onChange: renderPosition});
  tracker.start().catch(error => {
    console.error('Location setup failed', error);
    renderPosition({state: 'unavailable', fix: null, age: null});
  });
  const {placesReady, labelsReady} = loadDirectoryData();
  await initializeMapTransport();
  registerArchiveProtocol(maplibregl, pmtiles, archive);
  // This MapLibre bundle has no supported() helper. Map construction reports
  // graphics initialization errors through the existing startup catch handler.
  map = createMap({
    engine: maplibregl,
    container: 'map',
    basemapURL: basemapURL(dataSources, archive.url, !!archive.local),
    assetBaseURL: location.href,
    options: {
      center: DEFAULT_CENTER,
      zoom: DISCOVER_ZOOM
    }
  });
  installPublicMapDebug();
  installPositionBadge();
  map.on('load', () => installPublicLayers(placesReady, labelsReady));
  registerPublicMapEvents();
  warnAboutSlowStartup();
}

// These independent requests never block streets/buildings and each reports its own failure.
function loadDirectoryData() {
  const placesReady = Promise.all([
    loadJSON('data/places.geojson', 'Places'),
    loadJSON('data/place-visibility.json', 'Place levels')
  ])
    .then(([data, config]) => {
      if (!Array.isArray(data?.features)) throw new Error('Places: missing features');
      visibilityConfig = parseVisibilityConfig(config);
      allPlaces = normalizePlaces(data.features, visibilityConfig);
      markerKeysByPlaceId = markerKeys(allPlaces);
      placesById = new Map(allPlaces.map(feature => [String(feature.properties.id), feature]));
      filteredPlaces = allPlaces;
    })
    .catch(error => {
      console.error(error);
      placesError = error.message;
      notify(`Places could not load (${error.message}). Streets and buildings are still shown.`);
      renderResults();
    });
  const labelsReady = loadJSON('data/building-labels.geojson', 'House numbers')
    .then(labels => {
      buildingAddresses = buildingAddressIndex(labels);
      return labels;
    })
    .catch(error => {
      console.error(error);
      notify(`House numbers could not load (${error.message}). Building details may lack addresses.`);
    });
  return {placesReady, labelsReady};
}

// Storage and server/mock selection remain public-app adapters, not shared map policy.
async function initializeMapTransport() {
  if ('serviceWorker' in navigator && isSecureContext) {
    serviceWorkerRegistration = await registerAppUpdates().catch(error => {
      notify('Offline setup failed: ' + error.message);
      return null;
    });
  }
  dataMode = await loadDataMode();
  dataSources = dataEndpoints(dataMode, location.href);
  document.documentElement.dataset.api = dataMode;
  manifest = await loadJSON('data/manifest.json', 'Map metadata');
  archive = new ArchiveSource(new URL(manifest.archive.path, location.href).href, manifest);
  try {
    await archive.init();
  } catch {
    storageNote('Local storage unavailable. Online map is still usable.');
  }
  updateDownload();
}

// Exposed for existing browser QA and manual inspection; no map instance is copied or replaced.
function installPublicMapDebug() {
  window.kompasDebug = {
    get map() {
      return map;
    },
    get endpoints() {
      return structuredClone(endpoints);
    },
    get offline() {
      return !!archive.local;
    },
    get selected() {
      return selectedPlace?.properties.id ?? null;
    },
    get placeCount() {
      return allPlaces.length;
    },
    get satellite() {
      return satelliteVisible;
    },
    get transport() {
      return !!transport?.enabled;
    },
    get dataMode() {
      return dataMode;
    },
    get position() {
      return position.state;
    },
    get explored() {
      return explored;
    }
  };
}

function installPositionBadge() {
  map.addControl(
    {
      onAdd() {
        const control = elementById('position-badge');
        control.classList.add('maplibregl-ctrl', 'maplibregl-ctrl-group');
        return control;
      },
      onRemove() {
        elementById('position-badge')?.remove();
      }
    },
    'bottom-right'
  );
}

// Preserve public layer ordering and the selected-result exception; core supplies reusable rendering.
function installPublicPlaceLayers() {
  // PV-01/PV-02: each level is a zoom range, so eligibility is decided before any collision placement.
  installPlaceIcons(map, placeColors);
  map.addSource('places', {
    type: 'geojson',
    data: collection([]),
    promoteId: 'markerKey'
  });
  map.addSource('requested-place', {type: 'geojson', data: collection([])});
  map.addLayer(
    {
      id: 'place-highlight',
      type: 'circle',
      source: 'places',
      filter: ['==', ['get', 'first'], true],
      paint: {
        'circle-radius': 14,
        'circle-color': '#c43f3f',
        'circle-opacity': 0,
        'circle-stroke-color': '#c43f3f',
        'circle-stroke-width': 0
      }
    },
    'road-labels'
  );
  // The one requested result uses its existing geographic anchor and category icon below its own threshold.
  map.addLayer({
    id: 'search-place',
    type: 'symbol',
    source: 'requested-place',
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.1],
      'text-optional': true
    },
    paint: {
      'text-color': '#304c3e',
      'text-halo-color': '#fffff9',
      'text-halo-width': 2
    }
  });
}

function installCityNames() {
  const cities = [
    ['Podgorica', 19.26, 42.437],
    ['Nikšić', 18.944, 42.774],
    ['Cetinje', 18.922, 42.39],
    ['Budva', 18.84, 42.286],
    ['Kotor', 18.771, 42.424],
    ['Bar', 19.098, 42.092],
    ['Ulcinj', 19.206, 41.929],
    ['Herceg Novi', 18.537, 42.454],
    ['Žabljak', 19.121, 43.154],
    ['Pljevlja', 19.359, 43.357],
    ['Kolašin', 19.522, 42.824],
    ['Berane', 19.87, 42.843]
  ];
  map.addSource('cities', {
    type: 'geojson',
    data: collection(
      cities.map(([name, longitude, latitude]) => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [longitude, latitude]},
        properties: {name}
      }))
    )
  });
  map.addLayer({
    id: 'city-names',
    type: 'symbol',
    source: 'cities',
    maxzoom: 13,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 13
    },
    paint: {
      'text-color': '#3c5945',
      'text-halo-color': '#fafaf0',
      'text-halo-width': 2
    }
  });
}

// App workflows attach to the shared map after its common sources/layers have loaded.
function installPublicLayers(placesReady, labelsReady) {
  elementById('satellite-toggle').disabled = false;
  installPublicPlaceLayers();
  installCityNames();
  installTransport(map);
  installRoutePoints(map);
  installEntranceLayers(map);
  objectSelection = new ObjectSelection(map, footprintIndex => selectBuildingEntrances(map, footprintIndex));
  routePlanner = new RoutePlanner(map);
  transport = new TransportFeed(map, {
    url: dataSources.vehicles,
    onStatus: renderTransportStatus
  });
  elementById('transport-toggle').disabled = false;
  installPositionLayers(map);
  renderPosition(position);
  Promise.all([placesReady, labelsReady]).then(([, labels]) => {
    if (labels) {
      map.getSource('building-addresses').setData(buildingMapFeatures(labels));
      map.getSource('building-entrances').setData(entranceFeatures(labels));
    }
    if (!placesError) {
      const {names, icons} = placeLayers(placeBands(allPlaces, visibilityConfig), visibilityConfig);
      for (const layer of [...names, ...icons]) map.addLayer(layer, 'road-labels');
      placeHitLayers = ['search-place', ...icons.map(layer => layer.id), ...names.map(layer => layer.id)];
    }
    loaded = true;
    elementById('loading').hidden = true;
    filterPlaces();
  });
}

// Route endpoints, stops and listings win over generic geographic objects. Returns whether one was selected.
function selectTappedMarker(event) {
  const routePoints = map.queryRenderedFeatures(event.point, {
    layers: ['route-point-circles']
  });
  if (routePoints.length) {
    const feature = routePoints[0];
    showPoint(
      {
        name: feature.properties.name,
        coordinates: [...feature.geometry.coordinates],
        kind: feature.properties.role === 'from' ? 'From point' : 'To point',
        details: []
      },
      feature
    );
    return true;
  }
  const entrances = map.queryRenderedFeatures(event.point, {
    layers: ['entrance-points', 'entrance-selection-numbers', 'entrance-numbers', 'entrance-selection-arrows']
  });
  if (entrances.length) {
    showPoint(describePoint(entrances[0], event.lngLat.toArray(), buildingAddresses), entrances[0]);
    return true;
  }
  const stops = map.queryRenderedFeatures(event.point, {
    layers: ['transport-stops']
  });
  if (stops.length) {
    showPoint(describePoint(stops[0], event.lngLat.toArray()), stops[0]);
    return true;
  }
  const listings = listingsAtHits(
    map.queryRenderedFeatures(event.point, {layers: placeHitLayers}),
    placesById
  );
  if (listings.length === 1) {
    showPlace(listings[0].properties.id);
    return true;
  }
  if (listings.length > 1) {
    showChooser(listings, event.lngLat.toArray());
    return true;
  }
  return false;
}

// Listings win over geography; among geographic objects the most specific one under the tap wins.
function selectTappedFeature(event) {
  if (!loaded) return;
  if (selectTappedMarker(event)) return;
  const roadLayers = [
    'road-labels',
    'steps',
    'cycleways',
    'paths',
    'footways',
    'pedestrian-streets',
    'minor-roads',
    'major-roads'
  ];
  const features = map.queryRenderedFeatures(event.point, {
    layers: ['building-numbers', 'buildings', ...roadLayers, 'land', 'water', 'rivers']
  });
  const selectedFeature =
    features.find(feature => feature.layer.id === 'buildings') ??
    features.find(feature => feature.layer.id === 'building-numbers') ??
    features.find(feature => roadLayers.includes(feature.layer.id)) ??
    features.find(feature => feature.layer.id === 'land' && feature.properties.kind === 'park') ??
    features.find(feature => feature.layer.id === 'water' || feature.layer.id === 'rivers');
  showPoint(describePoint(selectedFeature, event.lngLat.toArray(), buildingAddresses), selectedFeature);
}

function registerPublicMapEvents() {
  map.on('movestart', event => {
    if (ownMove) {
      ownMove = false;
      return;
    }
    if (event.originalEvent && !explored) {
      explored = true;
      renderPosition(position);
    }
  });
  // The list keeps its order while a chosen place is open, so the row just used does not jump.
  map.on('moveend', () => {
    if (!selectedPlace) renderResults();
    flushPendingReveal();
  });
  installMapTaps(map, selectTappedFeature);
  map.on('mousemove', () => {
    if (loaded) map.getCanvas().style.cursor = 'crosshair';
  });
  registerMapFailures();
}

// A partly drawn map is not ready: errors name the affected data source.
function registerMapFailures() {
  const failures = {
    basemap:
      'Streets, buildings and water could not load. Check your connection or save the map for offline use.',
    'building-addresses': 'House numbers could not load.',
    'building-entrances': 'Building entrances could not load.',
    'satellite-preview': 'Satellite imagery could not load.',
    'satellite-tiles': 'Satellite imagery could not load.',
    places: 'Places could not be drawn.',
    'requested-place': 'Places could not be drawn.',
    'transport-stops': 'Bus stops could not load.'
  };
  // Tile bursts report many errors; wait for the last one so only one message appears.
  const mapErrorDelayMilliseconds = 1500;
  map.on('error', event => {
    console.error('Map error', event.error);
    const message =
      failures[event.sourceId] ??
      'Some map data could not load. Check your connection or download the map for offline use.';
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => notify(message), mapErrorDelayMilliseconds);
  });
  map.on('webglcontextlost', () =>
    notify('The browser paused graphics rendering. Waiting for it to recover…')
  );
  map.on('webglcontextrestored', () => {
    elementById('error').hidden = true;
    map.triggerRepaint();
  });
}

function warnAboutSlowStartup() {
  const startupTimeoutMilliseconds = 20000;
  setTimeout(() => {
    if (loaded) return;
    elementById('loading').hidden = true;
    notify('Map startup is taking longer than expected. Check your connection and try again.');
  }, startupTimeoutMilliseconds);
}

// Category toggles share the same filter and never move the camera.
function registerCategoryControls() {
  for (const [key, label] of Object.entries(categories)) {
    const button = createElement('button', label);
    button.type = 'button';
    button.dataset.category = key;
    button.setAttribute('aria-pressed', String(key === category));
    button.addEventListener('click', () => {
      category = category === key ? 'all' : key;
      for (const other of elementById('categories').children) {
        const active = other.dataset.category === category;
        other.setAttribute('aria-pressed', String(active));
        if (active) other.scrollIntoView({block: 'nearest', inline: 'nearest'});
      }
      filterPlaces();
    });
    elementById('categories').append(button);
  }
}

// Search and selection controls operate on the existing map and details card.
function registerSelectionControls() {
  elementById('search').addEventListener('input', () => {
    mapInterface.openSearch();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(filterPlaces, 120);
  });
  elementById('point-from').addEventListener('click', () => setEndpoint('from'));
  elementById('point-to').addEventListener('click', () => setEndpoint('to'));
  elementById('clear-route-points').addEventListener('click', () => {
    endpoints.from = null;
    endpoints.to = null;
    renderEndpoints();
  });
  elementById('close-place').addEventListener('click', () => closePlace());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!elementById('place-card').hidden) closePlace();
      else mapInterface.close(true);
    }
    if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
      event.preventDefault();
      elementById('search').focus();
    }
  });
}

// Optional layers keep their own availability and connection states.
function registerLayerControls() {
  elementById('satellite-toggle').addEventListener('click', () => {
    if (!loaded) return;
    satelliteVisible = !satelliteVisible;
    setSatelliteVisible(map, satelliteVisible);
    elementById('satellite-toggle').setAttribute('aria-pressed', String(satelliteVisible));
    elementById('satellite-note').hidden = !satelliteVisible;
    if (satelliteVisible) {
      closePlace(false);
      explored = true;
      const [west, south, east, north] = satelliteBounds;
      map.easeTo({
        center: [(west + east) / 2, (south + north) / 2],
        zoom: 17.5,
        duration: prefersReducedMotion ? 0 : 600
      });
    }
  });
  elementById('transport-toggle').addEventListener('click', () => {
    if (!transport) return;
    const enabled = !transport.enabled;
    if (!enabled && selectedPoint?.kind === 'Bus stop') closePlace(false);
    elementById('transport-toggle').setAttribute('aria-pressed', String(enabled));
    elementById('transport-info').hidden = !enabled;
    transport.setEnabled(enabled);
    if (enabled) {
      closePlace(false);
      explored = true;
      map.easeTo({center: [19.26, 42.44], zoom: 12, duration: prefersReducedMotion ? 0 : 450});
      if (!navigator.onLine) transport.pause('offline');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!transport?.enabled) return;
    if (document.hidden) transport.pause('paused');
    else if (navigator.onLine) transport.refresh();
  });
  addEventListener('offline', () => transport?.pause('offline'));
  addEventListener('online', () => {
    if (transport?.enabled && !document.hidden) transport.refresh();
  });
}

// Downloads and location actions report failures in the common visible error panel.
function registerDeviceControls() {
  elementById('download').addEventListener('click', startDownload);
  elementById('cancel-download').addEventListener('click', () => downloadAbort?.abort());
  elementById('remove-download').addEventListener('click', async () => {
    try {
      await archive.remove();
      storageNote('');
      updateDownload();
    } catch (error) {
      notify('Could not remove offline map: ' + error.message);
    }
  });
  elementById('retry').addEventListener('click', () => location.reload());
  elementById('dismiss-error').addEventListener('click', () => {
    elementById('error').hidden = true;
    mapInterface.restoreFocus(elementById('search'));
  });
  elementById('position-action').addEventListener('click', positionAction);
  addEventListener('online', updateConnection);
  addEventListener('offline', updateConnection);
}

// Interface callbacks run after construction and always use the current selection.
function initializeInterface() {
  mapInterface = new MapInterface({
    onSearch: () => {
      closePlace(false);
      filterPlaces();
    },
    onChange: () => {
      syncPanels();
      if (mapInterface && mapInterface.view !== 'closed' && !explored) {
        explored = true;
        renderPosition(position);
      }
      if (mapInterface?.view === 'closed') {
        previewPlace = null;
        updatePlaceLayers();
      }
    },
    // Recompute selection framing only after keyboard and camera changes have settled.
    onViewport: () => {
      const hasSelection = selectedPoint || pendingReveal;
      if (!loaded || !hasSelection || mapInterface.keyboardOpen()) return;
      // Building bounds already account for the card; an intermediate zoom would undo their fit.
      if (selectedPoint?.entrances?.length) {
        if (!map.isMoving()) frameBuildingEntrances(selectedPoint.entrances, selectedPoint.coordinates);
        return;
      }
      if (map.isMoving()) {
        pendingReveal ??= {zoom: map.getZoom()};
        return;
      }
      if (pendingReveal) {
        flushPendingReveal();
        return;
      }
      revealCoordinates(selectedPoint.coordinates, {zoom: map.getZoom(), duration: 0});
    },
    onCardSwipedAway: () => closePlace(),
    resultsLabel: () => {
      const query = elementById('search').value.trim();
      return query ? `“${query}”` : category === 'all' ? 'Results' : categories[category];
    }
  });
}

registerCategoryControls();
registerSelectionControls();
registerLayerControls();
registerDeviceControls();
initializeInterface();
start().catch(error => {
  console.error(error);
  elementById('loading').hidden = true;
  notify(error.message || 'Map startup failed.');
});
