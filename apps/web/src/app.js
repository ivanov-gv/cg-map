// The public map's startup and workflow state: search, selection, route endpoints, location and live transport.
// Shared map rendering comes from map-core; the modules imported below each own one part of the page.
import {
  createMap,
  registerArchiveProtocol,
  mapBounds,
  setSatelliteVisible,
  satelliteBounds,
  parseVisibilityConfig,
  normalizePlaces,
  markerKeys,
  placeBands,
  buildPlaceMarkers,
  requestedPlaceMarker,
  placeLayers
} from '@ivanov-gv/map-core';
import {
  categories,
  matchesSearch,
  nearestPlaces,
  featureCollection,
  formatCoordinates,
  formatDistance,
  DEFAULT_CENTER,
  DISCOVER_ZOOM
} from './core.js';
import {registerAppUpdates} from './app-updates.js';
import {resolveDataMode, dataEndpoints, basemapURL} from './data-mode.js';
import {animationMilliseconds, createElement, elementById} from './dom.js';
import {MapInterface, isInFocusZone} from './interface.js';
import {installMapTaps} from './map-taps.js';
import {ObjectSelection} from './object-selection.js';
import {ArchiveSource} from './offline.js';
import {OfflinePanel, renderConnectionBadge} from './offline-panel.js';
import {listingButton, renderListingChooser, renderPlaceCard, renderPointCard} from './place-card.js';
import {
  buildingAddressIndex,
  buildingMapFeatures,
  entranceFeatures,
  installEntranceLayers,
  selectBuildingEntrances,
  endpointFeatures,
  installRoutePoints
} from './point-selection.js';
import {PositionTracker, positionFeatures, installPositionLayers} from './position.js';
import {installCityNames, installPlaceSearchLayers} from './public-layers.js';
import {RoutePlanner} from './route-planner.js';
import {
  FAILED_POSITION_STATES,
  hasUsablePosition,
  positionActionLabel,
  positionIndicator,
  positionMessage,
  positionStatusText,
  transportStatusText
} from './status-text.js';
import {tapTarget} from './tap-targets.js';
import {installTransport, TransportFeed} from './transport.js';

// Map and the modules that draw on it; each exists once the map has loaded.
let map;
let mapInterface;
let objectSelection;
let routePlanner;
let transport;
let isMapLoaded = false;
let isSatelliteVisible = false;

// Where data comes from: the host's data mode, its endpoints, and the archive for the basemap and offline use.
let dataMode;
let apiEndpoints;
let archive;

// The directory, as loaded, and the part the current search and category admit.
let places = [];
let matchingPlaces = [];
let placesById = new Map();
let markerKeysById = new Map();
let visibility;
let placesError = null;
let buildingAddresses = new Map();
let category = 'all';
// Every layer whose rendered markers stand for a listing; place bands add theirs once they exist.
let placeHitLayers = ['search-place'];
// What the requested-place layer currently shows, so an unchanged result does not redraw it.
let requestedMarkerKey = null;

// What the card shows. A selected listing is also a selected point; a preview is the leading search match.
let selectedPlace = null;
let previewPlace = null;
let selectedPoint = null;
let isChoosingListing = false;
let focusReturnTarget = null;
// A camera move waiting for the keyboard to close: {zoom, duration?, coordinates?}.
let pendingReveal = null;
const endpoints = {from: null, to: null};

// Location. hasExplored is set once the person moves the map or opens a panel, and stops automatic centring.
let tracker;
let positionSnapshot = {state: 'idle', fix: null, age: null};
let hasExplored = false;
let hasCenteredOnFix = false;
let isLocationRequested = false;
// Set before a camera move the app starts, so its movestart is not taken as the person exploring.
let isOwnCameraMove = false;

let mapErrorTimer;
let searchTimer;

const selectionZoom = 15;
const cameraMilliseconds = 450;
const fixCenteringMilliseconds = 600;
const locateMilliseconds = 500;
const satelliteMilliseconds = 600;
const searchDebounceMilliseconds = 120;
const satelliteZoom = 17.5;
const transportOverviewCenter = [19.26, 42.44];
const transportOverviewZoom = 12;

function notify(message) {
  elementById('error-text').textContent = message;
  elementById('error').hidden = false;
}

function clearNotice() {
  elementById('error').hidden = true;
}

async function loadJSON(path, description) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${description}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${description}: invalid JSON`, {cause: error});
  }
}

// Returns null when the request itself failed, which is what an offline start looks like.
async function fetchHostConfig() {
  try {
    return await fetch('config.json', {cache: 'no-store'});
  } catch (error) {
    console.warn('config.json unreachable (offline start); using bundled data', error);
    return null;
  }
}

// config.json comes from the host: the Go server answers {"api":"server"}, static hosts serve the artifact's
// {"api":"mock"}. A missing file, an offline start or a server error falls back to the bundled data (a server error
// visibly). Other HTTP errors and invalid content stop startup.
async function loadDataMode() {
  const response = await fetchHostConfig();
  let config = null;
  if (response?.ok) {
    try {
      config = await response.json();
    } catch (error) {
      throw new Error('Invalid config.json: ' + error.message, {cause: error});
    }
  } else if (response?.status >= 500) {
    notify(
      `Server settings unavailable (HTTP ${response.status}). Showing preview data; live buses use the public relay.`
    );
  } else if (response && response.status !== 404) {
    throw new Error('Could not load config.json: HTTP ' + response.status);
  }
  return resolveDataMode(location.search, config);
}

function renderTransportStatus(status) {
  const line = elementById('transport-status');
  line.textContent = transportStatusText(status);
  line.dataset.state = status.state;
}

// The endpoints bar shares the map's top edge with search, the dock and the card, so it shows only when none is open.
function syncRouteEndpointsPanel() {
  const hasEndpoint = Boolean(endpoints.from || endpoints.to);
  const isPanelOpen = mapInterface?.view !== 'closed' || !elementById('place-card').hidden;
  elementById('route-endpoints').hidden = !hasEndpoint || isPanelOpen;
}

// Centres coordinates in the part of the map no panel covers, never zooming out.
function easeToUncovered(coordinates, zoom, duration) {
  hasExplored = true;
  map.easeTo({
    center: coordinates,
    zoom: Math.max(map.getZoom(), zoom),
    offset: mapInterface.mapOffset(),
    duration: animationMilliseconds(duration)
  });
}

function focusCoordinates(coordinates, zoom = selectionZoom, duration = cameraMilliseconds) {
  if (!map) return;
  easeToUncovered(coordinates, zoom, duration);
}

// Keep a chosen place visible with as little camera movement as possible: pan only when it leaves the focus zone.
function revealCoordinates(coordinates, {zoom = selectionZoom, duration = cameraMilliseconds} = {}) {
  if (!map) return;
  hasExplored = true;
  const needsZoom = map.getZoom() < zoom;
  const isAlreadyInView = !needsZoom && isInFocusZone(map.project(coordinates), mapInterface.mapArea());
  if (isAlreadyInView) return;
  easeToUncovered(coordinates, zoom, duration);
}

// The camera stays still while the keyboard is up; a pending reveal waits for the layout it leaves behind.
function flushPendingReveal() {
  const coordinates = pendingReveal?.coordinates ?? selectedPoint?.coordinates;
  if (!pendingReveal || !coordinates || mapInterface.keyboardOpen()) return;
  const options = pendingReveal;
  pendingReveal = null;
  revealCoordinates(coordinates, options);
}

// Keep every recorded entrance clear of the header and card, without zooming closer than the selected view.
function frameBuildingEntrances(entrances, coordinates) {
  const area = mapInterface.mapArea();
  const horizontalMarginPixels = Math.min(64, (area.right - area.left) / 4);
  const verticalMarginPixels = 32;
  const canvas = map.getCanvas();
  const bounds = new maplibregl.LngLatBounds();
  for (const position of [coordinates, ...entrances.map(entrance => entrance.coordinates)]) bounds.extend(position);
  const padding = {
    left: area.left + horizontalMarginPixels,
    right: canvas.clientWidth - area.right + horizontalMarginPixels,
    top: area.top + verticalMarginPixels,
    bottom: canvas.clientHeight - area.bottom + verticalMarginPixels
  };
  map.fitBounds(bounds, {
    padding,
    maxZoom: map.getZoom(),
    duration: animationMilliseconds(cameraMilliseconds),
    retainPadding: false
  });
}

const hasExplicitFilter = () => Boolean(elementById('search').value.trim()) || category !== 'all';

// Admission is fixed by each band's zoom range. Only the selected listing, or otherwise the leading explicit result,
// may also appear below its threshold.
function renderRequestedPlace() {
  if (!isMapLoaded || placesError) return;
  const previewMarkerKey = selectedPlace || !previewPlace ? null : markerKeysById.get(previewPlace.properties.id);
  objectSelection.setPreview(previewMarkerKey);
  const requestedPlace = selectedPlace ?? previewPlace;
  const {features, maxzoom} = requestedPlaceMarker(requestedPlace, matchingPlaces, markerKeysById, visibility);
  const markerKey = `${features[0]?.properties.activeIds}@${maxzoom}`;
  if (markerKey === requestedMarkerKey) return;
  requestedMarkerKey = markerKey;
  map.getSource('requested-place').setData(featureCollection(features));
  map.setLayerZoomRange('search-place', 0, maxzoom);
}

// While someone searches, the match nearest the map centre leads and is marked on the map.
function previewNearestMatch() {
  if (!isMapLoaded || placesError || mapInterface.view === 'closed' || !hasExplicitFilter()) return;
  previewPlace = nearestPlaces(matchingPlaces, map.getCenter().toArray(), 1)[0]?.place ?? null;
  renderRequestedPlace();
  renderResults();
}

function setChoosingListing(isActive) {
  isChoosingListing = isActive;
  elementById('point-actions').hidden = isActive;
}

function markCurrentResult() {
  const currentId = String((selectedPlace ?? previewPlace)?.properties.id);
  for (const row of elementById('results').querySelectorAll('.result')) {
    if (row.dataset.id === currentId) {
      row.setAttribute('aria-current', 'true');
      row.scrollIntoView({block: 'nearest'});
    } else {
      row.removeAttribute('aria-current');
    }
  }
}

// Focus returns to what opened the card, or to the map for a tapped point.
function closeCard(shouldRestoreFocus = true) {
  const hadPoint = Boolean(selectedPoint) || isChoosingListing;
  selectedPoint = null;
  selectedPlace = null;
  pendingReveal = null;
  setChoosingListing(false);
  elementById('place-card').hidden = true;
  mapInterface?.resetCardState();
  objectSelection?.clear();
  renderRequestedPlace();
  markCurrentResult();
  if (shouldRestoreFocus && focusReturnTarget) {
    const canReturnFocus = focusReturnTarget.isConnected && focusReturnTarget.getClientRects().length > 0;
    mapInterface?.restoreFocus(canReturnFocus ? focusReturnTarget : elementById('search'));
  } else if (shouldRestoreFocus && hadPoint) {
    map?.getCanvas().focus({preventScroll: true});
  }
  focusReturnTarget = null;
  syncRouteEndpointsPanel();
}

// trigger is the result row that opened the listing, if any; closing the card returns focus to it.
function showPlace(id, trigger) {
  const place = placesById.get(String(id));
  if (!place) return;
  setChoosingListing(false);
  selectedPlace = place;
  selectedPoint = {name: place.properties.name, coordinates: [...place.geometry.coordinates]};
  focusReturnTarget = trigger ?? null;
  renderPlaceCard(place);
  previewPlace = null;
  renderRequestedPlace();
  elementById('search').blur();
  elementById('place-card').hidden = false;
  mapInterface.placeCardOpened();
  elementById('place-card').scrollTop = 0;
  syncRouteEndpointsPanel();
  markCurrentResult();
  objectSelection.selectPlace(place, markerKeysById.get(place.properties.id));
  elementById('close-place').focus({preventScroll: true});
  pendingReveal = {zoom: selectionZoom};
  flushPendingReveal();
}

// The recorded entrances of a tapped building, its label or one of its entrances; empty for anything else.
function buildingEntrances(point, feature) {
  if (point.kind !== 'Building') return [];
  const footprintIndex = feature?.layer?.id === 'buildings' ? feature.id : feature?.properties?.footprintIndex;
  return buildingAddresses.get(footprintIndex)?.entrances ?? [];
}

// Selection uses the existing details card and original footprint; entrance bounds keep the arrows visible.
function showPoint(point, feature = null) {
  closeCard(false);
  selectedPoint = point;
  renderPointCard(point);
  elementById('place-card').hidden = false;
  previewPlace = null;
  renderRequestedPlace();
  mapInterface.close();
  mapInterface.placeCardOpened();
  syncRouteEndpointsPanel();
  objectSelection.select(feature, point.coordinates);
  const entrances = buildingEntrances(point, feature);
  if (entrances.length) {
    selectedPoint = {...point, entrances};
    frameBuildingEntrances(entrances, point.coordinates);
  } else {
    focusCoordinates(point.coordinates, map.getZoom());
  }
  elementById('close-place').focus({preventScroll: true});
}

// Several listings under one tap: same location, or nearby markers that overlap. Each stays a real listing.
function showChooser(listings, coordinates) {
  closeCard(false);
  setChoosingListing(true);
  const list = renderListingChooser(listings, place => showPlace(place.properties.id));
  elementById('search').blur();
  elementById('place-card').hidden = false;
  previewPlace = null;
  renderRequestedPlace();
  mapInterface.placeCardOpened();
  // The list must be usable at once, so a phone card opens full instead of as a header-only peek.
  if (mapInterface.view === 'search') mapInterface.setCardState('full');
  syncRouteEndpointsPanel();
  pendingReveal = {zoom: map.getZoom(), coordinates};
  flushPendingReveal();
  list.firstElementChild.focus({preventScroll: true});
}

function renderEndpoints() {
  for (const role of ['from', 'to']) {
    const point = endpoints[role];
    elementById('route-' + role).textContent = point
      ? `${point.name} · ${formatCoordinates(point.coordinates)}`
      : 'Not selected';
  }
  syncRouteEndpointsPanel();
  map.getSource('route-points').setData(endpointFeatures(endpoints));
  routePlanner?.setEndpoints(endpoints);
}

function setEndpoint(role) {
  if (!selectedPoint) return;
  endpoints[role] = {name: selectedPoint.name, coordinates: [...selectedPoint.coordinates]};
  // Route controls live on the map, so choosing an endpoint leaves search or the dock.
  mapInterface.close();
  renderEndpoints();
  closeCard();
}

function renderResults() {
  if (!map) return;
  const list = elementById('results');
  // A failed load is an error state, never an empty search result.
  if (placesError) {
    list.replaceChildren(createElement('p', `Places could not load (${placesError}). Reload to try again.`, 'empty'));
    return;
  }
  const nearest = nearestPlaces(matchingPlaces, map.getCenter().toArray());
  if (!nearest.length) {
    list.replaceChildren(createElement('p', 'No places found. Try another search or category.', 'empty'));
    return;
  }
  const currentId = (selectedPlace ?? previewPlace)?.properties.id;
  const rows = nearest.map(({place, distanceKilometres}) => {
    const distanceText = formatDistance(distanceKilometres * 1000);
    const row = listingButton(place, () => showPlace(place.properties.id, row), distanceText);
    if (place.properties.id === currentId) row.setAttribute('aria-current', 'true');
    return row;
  });
  list.replaceChildren(...rows);
}

// A search or category narrows the candidates; matching icons keep their thresholds.
function filterPlaces() {
  const query = elementById('search').value;
  matchingPlaces = places.filter(place => matchesSearch(place, query, category));
  if (isMapLoaded && !placesError) {
    const markers = buildPlaceMarkers(matchingPlaces, markerKeysById);
    map.getSource('places').setData(featureCollection(markers));
  }
  const isSelectionFilteredOut =
    selectedPlace && !matchingPlaces.some(place => place.properties.id === selectedPlace.properties.id);
  if (isChoosingListing || isSelectionFilteredOut) closeCard(false);
  previewPlace = null;
  renderRequestedPlace();
  renderResults();
  previewNearestMatch();
}

// Only an explicit request turns a failure into an error notice; the badge alone reports the rest.
function reportRequestedPositionFailure(snapshot) {
  if (!isLocationRequested) return;
  if (FAILED_POSITION_STATES.includes(snapshot.state)) {
    notify(positionMessage(snapshot));
    isLocationRequested = false;
    return;
  }
  if (snapshot.state === 'stale' && tracker?.error) {
    notify('Location is not updating. Check device location settings and try again.');
    isLocationRequested = false;
  }
}

// Center once on the first usable fix, never after the person has started exploring, unless they asked.
function centerOnUsableFix({state, fix}) {
  const shouldCenter = hasUsablePosition(state) && ((!hasCenteredOnFix && !hasExplored) || isLocationRequested);
  if (!shouldCenter) return;
  const offset = isLocationRequested ? mapInterface.mapOffset() : [0, 0];
  hasCenteredOnFix = true;
  isLocationRequested = false;
  isOwnCameraMove = true;
  map.easeTo({
    center: fix.coordinates,
    zoom: Math.max(map.getZoom(), DISCOVER_ZOOM),
    offset,
    duration: animationMilliseconds(fixCenteringMilliseconds)
  });
}

function renderPosition(snapshot) {
  positionSnapshot = snapshot;
  const statusText = positionStatusText(snapshot, hasExplored);
  elementById('position-status').textContent = statusText;
  elementById('position-badge').dataset.state = snapshot.state;
  elementById('position-action').setAttribute('aria-label', `${positionActionLabel(snapshot.state)}. ${statusText}`);
  elementById('position-action').title = statusText;
  elementById('position-indicator').textContent = positionIndicator(snapshot.state);
  reportRequestedPositionFailure(snapshot);
  if (!map?.getSource('position')) return;
  map.getSource('position').setData(positionFeatures(snapshot));
  centerOnUsableFix(snapshot);
}

// The tracker cannot recover from these by watching again.
const unretryablePositionStates = ['denied', 'outside', 'insecure', 'unsupported'];

function locateMe() {
  mapInterface.close();
  closeCard(false);
  const {state, fix} = positionSnapshot;
  if (fix && hasUsablePosition(state)) {
    focusCoordinates(fix.coordinates, DISCOVER_ZOOM, locateMilliseconds);
    return;
  }
  isLocationRequested = true;
  // Rendering again reports the condition as an error now that it was asked for.
  if (unretryablePositionStates.includes(state)) {
    renderPosition(positionSnapshot);
    return;
  }
  tracker?.retry();
}

function startPositionTracking() {
  tracker = new PositionTracker({bounds: mapBounds, onChange: renderPosition});
  tracker.start().catch(error => {
    console.error('Location setup failed', error);
    renderPosition({state: 'unavailable', fix: null, age: null});
  });
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
  startPositionTracking();
  const {placesReady, labelsReady} = loadDirectoryData();
  await initializeDataSources();
  registerArchiveProtocol(maplibregl, pmtiles, archive);
  // This MapLibre bundle has no supported() helper. Map construction reports
  // graphics initialization errors through the existing startup catch handler.
  map = createMap({
    engine: maplibregl,
    container: 'map',
    basemapURL: basemapURL(apiEndpoints, archive.url, Boolean(archive.local)),
    assetBaseURL: location.href,
    options: {
      center: DEFAULT_CENTER,
      zoom: DISCOVER_ZOOM
    }
  });
  installPublicMapDebug();
  installPositionBadge();
  map.on('load', () => installAppLayers(placesReady, labelsReady));
  registerMapEvents();
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
      visibility = parseVisibilityConfig(config);
      places = normalizePlaces(data.features, visibility);
      markerKeysById = markerKeys(places);
      placesById = new Map(places.map(place => [String(place.properties.id), place]));
      matchingPlaces = places;
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

// Returns whether the offline shell worker is registered; without one, downloads stay off.
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext) return false;
  const registration = await registerAppUpdates().catch(error => {
    notify('Offline setup failed: ' + error.message);
    return null;
  });
  return Boolean(registration);
}

// Storage and server/mock selection remain public-app adapters, not shared map policy.
async function initializeDataSources() {
  const hasServiceWorker = await registerServiceWorker();
  dataMode = await loadDataMode();
  apiEndpoints = dataEndpoints(dataMode, location.href);
  document.documentElement.dataset.api = dataMode;
  const manifest = await loadJSON('data/manifest.json', 'Map metadata');
  archive = new ArchiveSource(new URL(manifest.archive.path, location.href).href, manifest);
  const offlinePanel = new OfflinePanel({
    archive,
    manifest,
    endpoints: apiEndpoints,
    hasServiceWorker,
    map: () => map,
    notify,
    clearNotice
  });
  await offlinePanel.initialize();
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
      return Boolean(archive.local);
    },
    get selected() {
      return selectedPlace?.properties.id ?? null;
    },
    get placeCount() {
      return places.length;
    },
    get satellite() {
      return isSatelliteVisible;
    },
    get transport() {
      return Boolean(transport?.enabled);
    },
    get dataMode() {
      return dataMode;
    },
    get position() {
      return positionSnapshot.state;
    },
    get explored() {
      return hasExplored;
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

// Called once places and house numbers have settled, loaded or failed. Only then do taps and search work.
function showDirectoryData(labels) {
  if (labels) {
    map.getSource('building-addresses').setData(buildingMapFeatures(labels));
    map.getSource('building-entrances').setData(entranceFeatures(labels));
  }
  if (!placesError) {
    const {names, icons} = placeLayers(placeBands(places, visibility), visibility);
    for (const layer of [...names, ...icons]) map.addLayer(layer, 'road-labels');
    placeHitLayers = ['search-place', ...icons.map(layer => layer.id), ...names.map(layer => layer.id)];
  }
  isMapLoaded = true;
  elementById('loading').hidden = true;
  filterPlaces();
}

// App workflows attach to the shared map after its common sources/layers have loaded. The order is the drawing order.
function installAppLayers(placesReady, labelsReady) {
  elementById('satellite-toggle').disabled = false;
  installPlaceSearchLayers(map);
  installCityNames(map);
  installTransport(map);
  installRoutePoints(map);
  installEntranceLayers(map);
  objectSelection = new ObjectSelection(map, footprintIndex => selectBuildingEntrances(map, footprintIndex));
  routePlanner = new RoutePlanner(map);
  transport = new TransportFeed(map, {url: apiEndpoints.vehicles, onStatus: renderTransportStatus});
  elementById('transport-toggle').disabled = false;
  installPositionLayers(map);
  renderPosition(positionSnapshot);
  Promise.all([placesReady, labelsReady]).then(([, labels]) => showDirectoryData(labels));
}

function selectTappedFeature(event) {
  if (!isMapLoaded) return;
  const target = tapTarget(map, event, {placeHitLayers, placesById, buildingAddresses});
  if (target.kind === 'place') showPlace(target.place.properties.id);
  else if (target.kind === 'chooser') showChooser(target.listings, target.coordinates);
  else showPoint(target.point, target.feature);
}

function registerMapEvents() {
  map.on('movestart', event => {
    if (isOwnCameraMove) {
      isOwnCameraMove = false;
      return;
    }
    const isPersonMoving = Boolean(event.originalEvent);
    if (isPersonMoving && !hasExplored) {
      hasExplored = true;
      renderPosition(positionSnapshot);
    }
  });
  // The list keeps its order while a chosen place is open, so the row just used does not jump.
  map.on('moveend', () => {
    if (!selectedPlace) renderResults();
    flushPendingReveal();
  });
  installMapTaps(map, selectTappedFeature);
  map.on('mousemove', () => {
    if (isMapLoaded) map.getCanvas().style.cursor = 'crosshair';
  });
  registerMapFailures();
}

// A partly drawn map is not ready: errors name the affected data source.
function registerMapFailures() {
  const failures = {
    basemap: 'Streets, buildings and water could not load. Check your connection or save the map for offline use.',
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
    clearTimeout(mapErrorTimer);
    mapErrorTimer = setTimeout(() => notify(message), mapErrorDelayMilliseconds);
  });
  map.on('webglcontextlost', () => notify('The browser paused graphics rendering. Waiting for it to recover…'));
  map.on('webglcontextrestored', () => {
    clearNotice();
    map.triggerRepaint();
  });
}

function warnAboutSlowStartup() {
  const startupTimeoutMilliseconds = 20000;
  setTimeout(() => {
    if (isMapLoaded) return;
    elementById('loading').hidden = true;
    notify('Map startup is taking longer than expected. Check your connection and try again.');
  }, startupTimeoutMilliseconds);
}

// Choosing the active category again returns to all places.
function toggleCategory(key) {
  category = category === key ? 'all' : key;
  for (const button of elementById('categories').children) {
    const isActive = button.dataset.category === category;
    button.setAttribute('aria-pressed', String(isActive));
    if (isActive) button.scrollIntoView({block: 'nearest', inline: 'nearest'});
  }
  filterPlaces();
}

function renderCategoryButtons() {
  for (const [key, label] of Object.entries(categories)) {
    const button = createElement('button', label);
    button.type = 'button';
    button.dataset.category = key;
    button.setAttribute('aria-pressed', String(key === category));
    button.addEventListener('click', () => toggleCategory(key));
    elementById('categories').append(button);
  }
}

function toggleSatellite() {
  if (!isMapLoaded) return;
  isSatelliteVisible = !isSatelliteVisible;
  setSatelliteVisible(map, isSatelliteVisible);
  elementById('satellite-toggle').setAttribute('aria-pressed', String(isSatelliteVisible));
  elementById('satellite-note').hidden = !isSatelliteVisible;
  if (!isSatelliteVisible) return;
  closeCard(false);
  hasExplored = true;
  const [west, south, east, north] = satelliteBounds;
  const imageryCenter = [(west + east) / 2, (south + north) / 2];
  map.easeTo({center: imageryCenter, zoom: satelliteZoom, duration: animationMilliseconds(satelliteMilliseconds)});
}

function toggleTransport() {
  if (!transport) return;
  const isEnabled = !transport.enabled;
  // A bus stop card would describe a layer that is about to disappear.
  if (!isEnabled && selectedPoint?.kind === 'Bus stop') closeCard(false);
  elementById('transport-toggle').setAttribute('aria-pressed', String(isEnabled));
  elementById('transport-info').hidden = !isEnabled;
  transport.setEnabled(isEnabled);
  if (!isEnabled) return;
  closeCard(false);
  hasExplored = true;
  map.easeTo({
    center: transportOverviewCenter,
    zoom: transportOverviewZoom,
    duration: animationMilliseconds(cameraMilliseconds)
  });
  if (!navigator.onLine) transport.pause('offline');
}

// Live positions are fetched only while they can be seen and reached.
function registerTransportLifecycle() {
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

function handleShortcut(event) {
  if (event.key === 'Escape') {
    if (!elementById('place-card').hidden) closeCard();
    else mapInterface.close(true);
  }
  const isTyping = document.activeElement?.tagName === 'INPUT';
  if (event.key === '/' && !isTyping) {
    event.preventDefault();
    elementById('search').focus();
  }
}

function registerControls() {
  elementById('search').addEventListener('input', () => {
    mapInterface.openSearch();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(filterPlaces, searchDebounceMilliseconds);
  });
  elementById('point-from').addEventListener('click', () => setEndpoint('from'));
  elementById('point-to').addEventListener('click', () => setEndpoint('to'));
  elementById('clear-route-points').addEventListener('click', () => {
    endpoints.from = null;
    endpoints.to = null;
    renderEndpoints();
  });
  elementById('close-place').addEventListener('click', () => closeCard());
  document.addEventListener('keydown', handleShortcut);
  elementById('satellite-toggle').addEventListener('click', toggleSatellite);
  elementById('transport-toggle').addEventListener('click', toggleTransport);
  registerTransportLifecycle();
  elementById('retry').addEventListener('click', () => location.reload());
  elementById('dismiss-error').addEventListener('click', () => {
    clearNotice();
    mapInterface.restoreFocus(elementById('search'));
  });
  elementById('position-action').addEventListener('click', locateMe);
  const renderConnection = () => renderConnectionBadge(Boolean(archive?.local));
  addEventListener('online', renderConnection);
  addEventListener('offline', renderConnection);
}

// Opening search or the dock counts as exploring; closing them drops the search preview.
function handleViewChange() {
  syncRouteEndpointsPanel();
  const isPanelOpen = mapInterface && mapInterface.view !== 'closed';
  if (isPanelOpen && !hasExplored) {
    hasExplored = true;
    renderPosition(positionSnapshot);
  }
  if (mapInterface?.view === 'closed') {
    previewPlace = null;
    renderRequestedPlace();
  }
}

// Recompute selection framing only after keyboard and camera changes have settled.
function reframeSelection() {
  const hasSelection = selectedPoint || pendingReveal;
  if (!isMapLoaded || !hasSelection || mapInterface.keyboardOpen()) return;
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
}

// The minimized results strip names what the list holds.
function resultsLabel() {
  const query = elementById('search').value.trim();
  if (query) return `“${query}”`;
  return category === 'all' ? 'Results' : categories[category];
}

renderCategoryButtons();
registerControls();
mapInterface = new MapInterface({
  onSearch: () => {
    closeCard(false);
    filterPlaces();
  },
  onChange: handleViewChange,
  onViewport: reframeSelection,
  onCardSwipedAway: () => closeCard(),
  resultsLabel
});
start().catch(error => {
  console.error(error);
  elementById('loading').hidden = true;
  notify(error.message || 'Map startup failed.');
});
