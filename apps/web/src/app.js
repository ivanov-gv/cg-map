import {createElement, elementById, isReducedMotionPreferred} from './shared/dom.js';
import {renderPlaceResults} from './selection/place-details.js';
import {PlaceSelection} from './selection/place-selection.js';
import {
  installCityNames,
  installPublicPlaceLayers,
  searchResultMarkerData,
  SearchHighlights
} from './map/public-map-layers.js';
import {selectTappedFeature} from './selection/map-selection.js';
import {OfflineControls, renderConnectionBadge} from './offline/offline-controls.js';
import {transportStatusText} from './shared/status-messages.js';
import {
  categories,
  collectSearchResults,
  indexBuildingLabels,
  matchesPlaceSearch,
  placesForMapLayer,
  rankSearchResults,
  featureCollection,
  DEFAULT_CENTER,
  DISCOVER_ZOOM
} from './shared/core.js';
import {
  createMap,
  registerArchiveProtocol,
  setSatelliteVisible,
  satelliteBounds,
  parseVisibilityConfig,
  normalizePlaces,
  markerKeys,
  placeBands,
  buildPlaceMarkers,
  placeLayers,
  roadLayerIds
} from '@ivanov-gv/map-core';
import {ArchiveSource} from './offline/offline.js';
import {installTransport, TransportFeed} from './transport/transport.js';
import {
  buildingAddress,
  buildingAddressIndex,
  buildingMapFeatures,
  describePoint,
  entranceFeatures,
  installEntranceLayers,
  selectBuildingEntrances,
  endpointFeatures,
  installRoutePoints,
  placesInsideFootprint
} from './selection/point-selection.js';
import {RoutePlanner} from './routing/route-planner.js';
import {ObjectSelection} from './selection/object-selection.js';
import {registerAppUpdates} from './offline/app-updates.js';
import {resolveDataMode, dataEndpoints, basemapURL} from './transport/data-mode.js';
import {installMapTaps} from './map/map-taps.js';
import {installPositionLayers} from './location/position.js';
import {LocationControls} from './location/location-controls.js';
import {MapInterface, hasActiveSearchFilter} from './interface/interface.js';
import {deviceClass, FLIP_MEDIA_QUERY, MOBILE_MEDIA_QUERY} from './shared/device-class.js';
import {renderMapAttribution} from './map/attribution.js';

// Re-renders the footer when sources or the viewport change; the renderer shortens the version when needed.
function renderCurrentAttribution() {
  if (!mapState.map) return;
  renderMapAttribution(mapState.map, startupState.build);
}

// Renders the current device class as a data attribute on <body>.
function renderDeviceClass() {
  document.body.dataset.device = deviceClass(matchMedia);
  renderCurrentAttribution();
}

// Sets data-device on <body> so CSS and scripts can target Flip, Mobile, or Desktop.
function trackDeviceClass() {
  renderDeviceClass();
  const flipQuery = matchMedia(FLIP_MEDIA_QUERY);
  const mobileQuery = matchMedia(MOBILE_MEDIA_QUERY);
  flipQuery.addEventListener('change', renderDeviceClass);
  mobileQuery.addEventListener('change', renderDeviceClass);
}

// Re-measures the footer when its own width changes, after layout has settled.
function trackFooterFit() {
  const container = document.getElementById('map-attribution');
  if (!container) return;
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', renderCurrentAttribution);
    return;
  }
  new ResizeObserver(renderCurrentAttribution).observe(container);
}

// One map and the controllers installed on it.
const mapState = {
  map: null,
  isMapReady: false,
  hasExploredMap: false,
  shouldIgnoreNextMove: false,
  isSatelliteVisible: false,
  interface: null,
  objectSelection: null,
  searchHighlights: null,
  routePlanner: null,
  transportFeed: null,
  errorTimer: null
};

// Loaded directory data and the active search, independent of the current selection.
const directoryState = {
  allPlaces: [],
  filteredPlaces: [],
  placesById: new Map(),
  activeCategory: null,
  buildingAddresses: new Map(),
  buildingLabelIndex: [],
  visibleRoads: [],
  roadNamesInView: new Set(),
  searchCandidates: [],
  results: [],
  loadingError: null,
  sourceDate: null,
  visibilityConfig: null,
  markerKeysByPlaceId: new Map(),
  placeHitLayers: ['search-place', 'search-result-places'],
  searchTimer: null,
  distanceRefreshTimer: null,
  lastDistanceRefreshAt: 0,
  hasPendingDistanceRerank: false
};

// Host and offline adapters are created during startup and shared with their UI controller.
const startupState = {
  archive: null,
  dataMode: null,
  dataSources: null,
  serviceWorkerRegistration: null,
  offlineControls: null,
  build: null
};

const routeEndpoints = {from: null, to: null};

const prefersReducedMotion = isReducedMotionPreferred();
const distanceRefreshDelayMilliseconds = 200;
// Road lines, not road labels: a label's point geometry cannot supply a street segment for the highlight or the card.
// Map-core owns the layer ids, so its road list stays in step when roads get '-on-bridge' copies later.
// 'park-routes' is the selectable cream line; 'park-route-casing' is only its wider decorative underlay.
const roadNameLayers = roadLayerIds([
  'steps',
  'cycleways',
  'paths',
  'footways',
  'park-routes',
  'pedestrian-streets',
  'minor-roads',
  'major-roads'
]);

const placeSelection = new PlaceSelection({
  map: () => mapState.map,
  interface: () => mapState.interface,
  directory: () => directoryState,
  objectSelection: () => mapState.objectSelection,
  describePoint: (feature, coordinates) => describePoint(feature, coordinates, directoryState.buildingAddresses),
  isMapReady: () => mapState.isMapReady,
  onExploreMap: () => {
    mapState.hasExploredMap = true;
  },
  onSelectionChanged: syncPanels,
  onResultsChanged: renderSearchResults,
  buildingAddress,
  placesInsideFootprint,
  prefersReducedMotion
});

const locationControls = new LocationControls({
  map: () => mapState.map,
  interface: () => mapState.interface,
  hasExploredMap: () => mapState.hasExploredMap,
  onAutomaticCameraMove: () => {
    mapState.shouldIgnoreNextMove = true;
  },
  closeSelection: () => placeSelection.close(false),
  onDistanceOriginChanged: scheduleDistanceRefresh,
  notify,
  prefersReducedMotion
});
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

function notify(message) {
  elementById('error-text').textContent = message;
  elementById('error').hidden = false;
}

function syncPanels() {
  updateSearchHighlights();
  elementById('route-endpoints').hidden =
    (!routeEndpoints.from && !routeEndpoints.to) ||
    mapState.interface?.view !== 'closed' ||
    !elementById('place-card').hidden;
  // Choosing another place card does not close the card, so only a real close consumes the deferred ranking.
  if (directoryState.hasPendingDistanceRerank && elementById('place-card').hidden) {
    directoryState.hasPendingDistanceRerank = false;
    refreshSearchResults();
  }
}

function renderRouteEndpoints() {
  for (const role of ['from', 'to']) {
    const point = routeEndpoints[role];
    elementById('route-' + role).textContent = point
      ? `${point.name} · ${point.coordinates
          .slice()
          .reverse()
          .map(coordinate => coordinate.toFixed(5))
          .join(', ')}`
      : 'Not selected';
  }
  syncPanels();
  mapState.map.getSource('route-points').setData(endpointFeatures(routeEndpoints));
  mapState.routePlanner?.setEndpoints(routeEndpoints);
}
function setRouteEndpoint(role) {
  if (!placeSelection.point) return;
  routeEndpoints[role] = {
    name: placeSelection.point.name,
    coordinates: [...placeSelection.point.coordinates]
  };
  // Route controls live on the map, so choosing an endpoint leaves search or the dock.
  mapState.interface.close();
  renderRouteEndpoints();
  placeSelection.close();
}

// The list and both highlight layers share one candidate set; row order and distance text follow the view center or a
// usable fix, while highlights always follow the view.
function searchQuery() {
  return elementById('search').value.trim();
}

function computeSearchCandidates() {
  const referencePoint = locationControls.distanceOrigin ?? mapState.map?.getCenter().toArray() ?? null;
  return collectSearchResults({
    places: directoryState.filteredPlaces,
    buildingLabels: directoryState.buildingLabelIndex,
    roads: directoryState.visibleRoads,
    query: searchQuery(),
    category: directoryState.activeCategory,
    markerKeys: directoryState.markerKeysByPlaceId,
    referencePoint
  });
}

// Query the current tile view once per settled camera change. Segment identity and name dedupe repeated tile copies.
function collectVisibleRoads() {
  if (!mapState.isMapReady || !mapState.map) return [];
  const seen = new Set();
  const features = [];
  for (const feature of mapState.map.queryRenderedFeatures({layers: roadNameLayers})) {
    const name = feature.properties?.name;
    if (typeof name !== 'string' || !name.trim()) continue;
    if (!['LineString', 'MultiLineString'].includes(feature.geometry?.type)) continue;
    const firstCoordinate = JSON.stringify(feature.geometry.coordinates[0] ?? null);
    const identity = `${name}\u0000${feature.id ?? ''}\u0000${firstCoordinate}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    features.push(feature);
  }
  return features;
}

// Street candidates depend on the current view; rebuilding them keeps a moved map's green roads and row order in step.
function refreshVisibleRoads() {
  const hasExplicitFilter = Boolean(searchQuery()) || directoryState.activeCategory !== null;
  directoryState.visibleRoads = hasExplicitFilter ? collectVisibleRoads() : [];
  directoryState.roadNamesInView = new Set(directoryState.visibleRoads.map(feature => feature.properties.name));
  directoryState.searchCandidates = computeSearchCandidates();
}

function rankSearchCandidates() {
  if (!mapState.map) return [];
  return rankSearchResults(directoryState.searchCandidates, mapState.map.getCenter().toArray(), {
    origin: locationControls.distanceOrigin
  });
}

// Rendering preserves focus when a camera move rebuilds rows after the selected card closes.
function renderSearchResults() {
  renderPlaceResults({
    results: directoryState.loadingError ? [] : directoryState.results,
    currentId: placeSelection.currentResultId,
    loadingError: directoryState.loadingError,
    onChoose: placeSelection.showSearchResult
  });
}

// Every in-view match is marked, including those past the 40-row list limit. An active filter supplies a marker for
// every result place; choosing a hidden match reveals it later. Search, selection and view handlers all call this, so
// a card or closed list never decides which marks the map shows.
function updateSearchHighlights() {
  if (!mapState.isMapReady || !mapState.searchHighlights) return;
  const hasQuery = Boolean(searchQuery());
  const hasCategory = directoryState.activeCategory !== null;
  if (!hasActiveSearchFilter({hasQuery, hasCategory})) {
    mapState.searchHighlights.clear();
    return;
  }
  const bounds = mapState.map.getBounds();
  const selectedId = String(placeSelection.currentResultId ?? '');
  const selectedFootprintIndex = placeSelection.selectedFootprintIndex;
  const visible = directoryState.searchCandidates.filter(result => {
    if (String(result.id) === selectedId) return false;
    if (selectedFootprintIndex !== null && result.footprintIndex === selectedFootprintIndex) return false;
    if (result.kind === 'street') return directoryState.roadNamesInView.has(result.streetName);
    return bounds.contains(result.coordinates);
  });
  mapState.searchHighlights.update(visible);
}

function refreshSearchResults() {
  directoryState.results = rankSearchCandidates();
  renderSearchResults();
  updateSearchHighlights();
}

function applyDistanceRefresh() {
  directoryState.lastDistanceRefreshAt = Date.now();
  if (placeSelection.hasOpenCard) {
    directoryState.hasPendingDistanceRerank = true;
    return;
  }
  // The representative point of a multi-segment street also follows a new fix, not only the row's ranking.
  directoryState.searchCandidates = computeSearchCandidates();
  refreshSearchResults();
}

// A new fix arrives independently of camera moves. Refresh at most once per interval with a final trailing run, and
// keep the open card's row order frozen until syncPanels() applies the deferred ranking when that card closes.
function scheduleDistanceRefresh() {
  if (directoryState.distanceRefreshTimer !== null) return;
  const elapsedMilliseconds = Date.now() - directoryState.lastDistanceRefreshAt;
  if (elapsedMilliseconds >= distanceRefreshDelayMilliseconds) {
    applyDistanceRefresh();
    return;
  }
  directoryState.distanceRefreshTimer = setTimeout(() => {
    directoryState.distanceRefreshTimer = null;
    applyDistanceRefresh();
  }, distanceRefreshDelayMilliseconds - elapsedMilliseconds);
}

// A category narrows the map's places; a query only narrows the result rows and rings.
function applyPlaceSearch() {
  const query = searchQuery();
  const hasCategory = directoryState.activeCategory !== null;
  const categoryPlaces = placesForMapLayer(directoryState.allPlaces, directoryState.activeCategory);
  directoryState.filteredPlaces = categoryPlaces.filter(feature =>
    matchesPlaceSearch(feature, query, directoryState.activeCategory)
  );
  if (mapState.isMapReady && !directoryState.loadingError) {
    mapState.map
      .getSource('places')
      .setData(
        featureCollection(buildPlaceMarkers(categoryPlaces, directoryState.markerKeysByPlaceId))
      );
    const hasExplicitFilter = Boolean(query) || hasCategory;
    // A category keeps all its places in the all-zoom overlay; the query narrows only rows and rings.
    const overlayPlaces = hasCategory ? categoryPlaces : directoryState.filteredPlaces;
    mapState.searchHighlights.setResultMarkers(
      hasExplicitFilter
        ? searchResultMarkerData(overlayPlaces, directoryState.markerKeysByPlaceId)
        : featureCollection([])
    );
  }
  placeSelection.onFilterChanged();
  refreshVisibleRoads();
  refreshSearchResults();
  placeSelection.updateRequestedPlace();
  // Update desktop search UI after results change.
  mapState.interface.syncDesktopSearchUI();
  mapState.interface.syncClearButton();
}

async function loadJSON(path, resourceLabel) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${resourceLabel}: HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${resourceLabel}: invalid JSON`, {cause: error});
  }
}
// D-06: the status always names the location condition; without a fix the default camera is a fallback view.

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
  locationControls.start();
  const {placesReady, labelsReady} = loadDirectoryData();
  await initializeMapTransport();
  registerArchiveProtocol(maplibregl, pmtiles, startupState.archive);
  // This MapLibre bundle has no supported() helper. Map construction reports
  // graphics initialization errors through the existing startup catch handler.
  mapState.map = createMap({
    engine: maplibregl,
    container: 'map',
    basemapURL: basemapURL(startupState.dataSources, startupState.archive.url, !!startupState.archive.local),
    assetBaseURL: location.href,
    options: {
      center: DEFAULT_CENTER,
      zoom: DISCOVER_ZOOM,
      attributionControl: false
    }
  });
  installPublicMapDebug();
  installOsmCredit();
  installPositionBadge();
  mapState.map.on('load', () => {
    installPublicLayers(placesReady, labelsReady);
    renderCurrentAttribution();
  });
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
      directoryState.visibilityConfig = parseVisibilityConfig(config);
      directoryState.allPlaces = normalizePlaces(data.features, directoryState.visibilityConfig);
      directoryState.markerKeysByPlaceId = markerKeys(directoryState.allPlaces);
      directoryState.placesById = new Map(
        directoryState.allPlaces.map(feature => [String(feature.properties.id), feature])
      );
      directoryState.filteredPlaces = directoryState.allPlaces;
    })
    .catch(error => {
      console.error(error);
      directoryState.loadingError = error.message;
      notify(`Places could not load (${error.message}). Streets and buildings are still shown.`);
      renderSearchResults();
    });
  const labelsReady = loadJSON('data/building-labels.geojson', 'House numbers')
    .then(labels => {
      directoryState.buildingAddresses = buildingAddressIndex(labels);
      directoryState.buildingLabelIndex = indexBuildingLabels(labels);
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
    startupState.serviceWorkerRegistration = await registerAppUpdates().catch(error => {
      notify('Offline setup failed: ' + error.message);
      return null;
    });
  }
  startupState.dataMode = await loadDataMode();
  startupState.dataSources = dataEndpoints(startupState.dataMode, location.href);
  document.documentElement.dataset.api = startupState.dataMode;
  const manifest = await loadJSON('data/manifest.json', 'Map metadata');
  startupState.build = manifest.build;
  directoryState.sourceDate = manifest.sourceTimestamp;
  startupState.archive = new ArchiveSource(new URL(manifest.archive.path, location.href).href, manifest);
  startupState.offlineControls = new OfflineControls({
    archive: startupState.archive,
    manifest,
    dataSources: startupState.dataSources,
    hasServiceWorker: Boolean(startupState.serviceWorkerRegistration),
    map: () => mapState.map,
    notify,
    clearNotice: () => {
      elementById('error').hidden = true;
    }
  });
  await startupState.offlineControls.initialize();
}

// Exposed for existing browser QA and manual inspection; no map instance is copied or replaced.
// deviceClass is the shared cached class; flipDockScreen reports the Flip dock screen ('list', 'modes', or null).
function installPublicMapDebug() {
  window.kompasDebug = {
    get map() {
      return mapState.map;
    },
    get endpoints() {
      return structuredClone(routeEndpoints);
    },
    get offline() {
      return !!startupState.archive.local;
    },
    get selected() {
      return placeSelection.selectedPlace?.properties.id ?? null;
    },
    get placeCount() {
      return directoryState.allPlaces.length;
    },
    get satellite() {
      return mapState.isSatelliteVisible;
    },
    get transport() {
      return !!mapState.transportFeed?.isEnabled;
    },
    get dataMode() {
      return startupState.dataMode;
    },
    get position() {
      return locationControls.state;
    },
    get explored() {
      return mapState.hasExploredMap;
    },
    get flipDockScreen() {
      return mapState.interface?.flipDockScreen ?? null;
    },
    get deviceClass() {
      return mapState.interface?.deviceClass ?? null;
    }
  };
}

// A small "OpenStreetMap" credit link sits below the scale bar in the bottom-left corner.
// MapLibre inserts bottom controls at the first child using insertBefore(el, firstChild)
// (src/ui/map.ts line 896), so this control — added after the scale bar — becomes the
// first DOM child. The CSS uses column-reverse so it renders at the bottom. See wiki
// Web app – UI and ADR 0016.
function installOsmCredit() {
  mapState.map.addControl(
    {
      onAdd() {
        const wrapper = document.createElement('div');
        wrapper.className = 'osm-credit-line';
        const link = document.createElement('a');
        link.href = 'https://www.openstreetmap.org/copyright';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'OpenStreetMap';
        wrapper.appendChild(link);
        return wrapper;
      },
      onRemove() {}
    },
    'bottom-left'
  );
}

function installPositionBadge() {
  mapState.map.addControl(
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

// App workflows attach to the shared map after its common sources/layers have loaded.
function installPublicLayers(placesReady, labelsReady) {
  elementById('satellite-toggle').disabled = false;
  installPublicPlaceLayers(mapState.map);
  mapState.searchHighlights = new SearchHighlights(mapState.map);
  installCityNames(mapState.map);
  installTransport(mapState.map);
  installRoutePoints(mapState.map);
  installEntranceLayers(mapState.map);
  mapState.objectSelection = new ObjectSelection(mapState.map, footprintIndex =>
    selectBuildingEntrances(mapState.map, footprintIndex)
  );
  mapState.routePlanner = new RoutePlanner(mapState.map);
  mapState.transportFeed = new TransportFeed(mapState.map, {
    url: startupState.dataSources.vehicles,
    onStatus: snapshot => {
      elementById('transport-status').textContent = transportStatusText(snapshot);
      elementById('transport-status').dataset.state = snapshot.state;
    }
  });
  elementById('transport-toggle').disabled = false;
  installPositionLayers(mapState.map);
  locationControls.refresh();
  Promise.all([placesReady, labelsReady]).then(([, labels]) => {
    if (labels) {
      mapState.map.getSource('building-addresses').setData(buildingMapFeatures(labels));
      mapState.map.getSource('building-entrances').setData(entranceFeatures(labels));
    }
    if (!directoryState.loadingError) {
      const {names, icons} = placeLayers(
        placeBands(directoryState.allPlaces, directoryState.visibilityConfig),
        directoryState.visibilityConfig
      );
      for (const layer of [...names, ...icons]) mapState.map.addLayer(layer, 'road-labels');
      directoryState.placeHitLayers = [
        'search-place',
        'search-result-places',
        ...icons.map(layer => layer.id),
        ...names.map(layer => layer.id)
      ];
    }
    mapState.isMapReady = true;
    elementById('loading').hidden = true;
    applyPlaceSearch();
  });
}

function registerPublicMapEvents() {
  // Re-render attribution when sources change (e.g. transport layer adds a source).
  // renderCurrentAttribution skips the DOM update when nothing changed.
  mapState.map.on('sourcedata', event => {
    if (event.sourceDataType === 'metadata' || event.isSourceAdded) {
      renderCurrentAttribution();
    }
  });
  mapState.map.on('movestart', event => {
    // noteCameraMoveStart must run before shouldIgnoreNextMove so the follower sees every movestart.
    locationControls.noteCameraMoveStart(event);
    if (mapState.shouldIgnoreNextMove) {
      mapState.shouldIgnoreNextMove = false;
      return;
    }
    if (event.originalEvent && !mapState.hasExploredMap) {
      mapState.hasExploredMap = true;
      locationControls.refresh();
    }
  });
  // MapLibre resize() fires synchronously: movestart, move, resize, moveend.
  // The resize event cancels the pending foreign move so following is not stopped by a viewport change.
  mapState.map.on('resize', () => locationControls.noteMapResize());
  // The list keeps its order while any card is open, so the row just used does not jump.
  mapState.map.on('moveend', () => {
    refreshVisibleRoads();
    if (!placeSelection.hasOpenCard) {
      directoryState.results = rankSearchCandidates();
      renderSearchResults();
    }
    updateSearchHighlights();
    placeSelection.flushPendingReveal();
  });
  // Symbol placement can finish after moveend, so settle the rings once the final marker set is drawn.
  mapState.map.on('idle', () => {
    refreshVisibleRoads();
    updateSearchHighlights();
  });
  installMapTaps(mapState.map, event =>
    selectTappedFeature(mapState.map, event, {
      isMapReady: mapState.isMapReady,
      placeHitLayers: directoryState.placeHitLayers,
      placesById: directoryState.placesById,
      buildingAddresses: directoryState.buildingAddresses,
      roadLayers: roadNameLayers,
      showPlace: placeSelection.showPlace,
      showPoint: placeSelection.showPoint,
      onEmptyTap: () => mapState.interface?.handleEmptyMapTap() ?? false
    })
  );
  mapState.map.on('mousemove', () => {
    if (mapState.isMapReady) mapState.map.getCanvas().style.cursor = 'crosshair';
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
  mapState.map.on('error', event => {
    console.error('Map error', event.error);
    const message =
      failures[event.sourceId] ??
      'Some map data could not load. Check your connection or download the map for offline use.';
    clearTimeout(mapState.errorTimer);
    mapState.errorTimer = setTimeout(() => notify(message), mapErrorDelayMilliseconds);
  });
  mapState.map.on('webglcontextlost', () =>
    notify('The browser paused graphics rendering. Waiting for it to recover…')
  );
  mapState.map.on('webglcontextrestored', () => {
    elementById('error').hidden = true;
    mapState.map.triggerRepaint();
  });
}

function warnAboutSlowStartup() {
  const startupTimeoutMilliseconds = 20000;
  setTimeout(() => {
    if (mapState.isMapReady) return;
    elementById('loading').hidden = true;
    notify('Map startup is taking longer than expected. Check your connection and try again.');
  }, startupTimeoutMilliseconds);
}

// UI-only key for the row's first chip; the shared category contract has no "all" entry.
const ALL_CATEGORIES_KEY = '';

// The row's first chip returns to all categories without changing the search query.
function registerCategoryControls() {
  const allButton = createElement('button', 'All');
  allButton.type = 'button';
  allButton.dataset.category = ALL_CATEGORIES_KEY;
  allButton.setAttribute('aria-label', 'All categories');
  allButton.addEventListener('click', () => selectCategory(null));
  const container = elementById('categories');
  container.append(allButton);

  for (const [key, label] of Object.entries(categories)) {
    const button = createElement('button', label);
    button.type = 'button';
    button.dataset.category = key;
    button.addEventListener('click', () => selectCategory(key));
    container.append(button);
  }
  // One shared pill and × follow the active chip, so every category row has the same control.
  const pill = createElement('span');
  pill.id = 'active-category-pill';
  pill.className = 'category-pill is-placeholder';
  const removeButton = document.createElement('button');
  removeButton.id = 'remove-category';
  removeButton.className = 'category-remove active-category-chip-remove';
  removeButton.type = 'button';
  removeButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-close"/></svg>';
  removeButton.addEventListener('click', removeCategory);
  // Keep one control in flow even for All: removing it would shrink scrollWidth and clamp the saved scroll position.
  removeButton.classList.add('is-placeholder');
  removeButton.setAttribute('aria-hidden', 'true');
  removeButton.disabled = true;
  removeButton.tabIndex = -1;
  pill.append(removeButton);
  container.append(pill);
  syncCategoryButtons();
}

// Clearing a category must not scroll the shared row back to All.
function removeCategory() {
  const categoriesRow = elementById('categories');
  const scrollLeft = categoriesRow.scrollLeft;
  selectCategory(null);
  categoriesRow.scrollLeft = scrollLeft;
}

function syncCategoryButtons() {
  const activeCategory = directoryState.activeCategory ?? ALL_CATEGORIES_KEY;
  const categoryButtons = [...elementById('categories').querySelectorAll('button[data-category]')];
  for (const button of categoryButtons)
    button.setAttribute('aria-pressed', String(button.dataset.category === activeCategory));
  syncCategoryPill(activeCategory, categoryButtons);
  categoryButtons
    .find(button => button.dataset.category === activeCategory)
    ?.scrollIntoView({block: 'nearest', inline: 'nearest'});
  mapState.interface?.syncStandaloneChips();
}

// Move the shared pill around the active chip; All parks it inert at the row's end.
function syncCategoryPill(activeCategory, categoryButtons) {
  const row = elementById('categories');
  const pill = elementById('active-category-pill');
  const removeButton = elementById('remove-category');
  const activeButton = categoryButtons.find(button => button.dataset.category === activeCategory);
  const previousButton = pill.querySelector('button[data-category]');

  if (previousButton && previousButton !== activeButton) {
    previousButton.classList.remove('active-category-chip-label');
    insertBeforeFollowingChip(row, previousButton, previousButton, categoryButtons);
  }
  if (!activeCategory || !activeButton) {
    row.append(pill);
    pill.classList.add('is-placeholder');
    removeButton.classList.add('is-placeholder');
    removeButton.setAttribute('aria-hidden', 'true');
    removeButton.removeAttribute('aria-label');
    removeButton.disabled = true;
    removeButton.tabIndex = -1;
    return;
  }

  activeButton.classList.add('active-category-chip-label');
  pill.insertBefore(activeButton, removeButton);
  insertBeforeFollowingChip(row, pill, activeButton, categoryButtons);
  pill.classList.remove('is-placeholder');
  removeButton.classList.remove('is-placeholder');
  removeButton.removeAttribute('aria-hidden');
  removeButton.setAttribute('aria-label', `Remove category ${categories[activeCategory]}`);
  removeButton.disabled = false;
  removeButton.tabIndex = 0;
}

// Keep the row's original chip order while one chip lives inside the shared pill.
function insertBeforeFollowingChip(row, element, referenceButton, categoryButtons) {
  const index = categoryButtons.indexOf(referenceButton);
  const followingChip = categoryButtons.slice(index + 1).find(button => button.parentElement === row);
  row.insertBefore(element, followingChip ?? null);
}

function selectCategory(key) {
  directoryState.activeCategory = directoryState.activeCategory === key ? null : key;
  syncCategoryButtons();
  // A floating desktop chip reveals the same results the dock row would show.
  if (!mapState.interface.isPhoneLayout && mapState.interface.view === 'closed')
    mapState.interface.showResults();
  applyPlaceSearch();
}

// Search and selection controls operate on the existing map and details card.
function registerSelectionControls() {
  elementById('search').addEventListener('input', () => {
    mapState.interface.openSearch();
    clearTimeout(directoryState.searchTimer);
    directoryState.searchTimer = setTimeout(applyPlaceSearch, 120);
  });
  elementById('point-from').addEventListener('click', () => setRouteEndpoint('from'));
  elementById('point-to').addEventListener('click', () => setRouteEndpoint('to'));
  elementById('clear-route-points').addEventListener('click', () => {
    routeEndpoints.from = null;
    routeEndpoints.to = null;
    renderRouteEndpoints();
  });
  elementById('close-place').addEventListener('click', () => {
    if (mapState.interface?.hasFlipCard) mapState.interface.stepBackOrCloseFlipCard();
    else placeSelection.close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      const isDesktop = mapState.interface.isDesktop;
      if (!elementById('place-card').hidden) {
        // On Flip, Escape follows the Icon Button: Fullscreen returns to Peek, then Peek closes.
        if (mapState.interface.hasFlipCard) mapState.interface.stepBackOrCloseFlipCard();
        else placeSelection.close();
      } else if (mapState.interface.view === 'dock') {
        // When the dock is open, Escape closes it.
        mapState.interface.close(true);
      } else if (isDesktop && mapState.interface.state === 'filled') {
        // On desktop with dock closed, Escape clears the query and refocuses the input; results stay Open.
        mapState.interface.clearQuery();
        mapState.interface.restoreFocus(elementById('search'));
      } else if (isDesktop && mapState.interface.state === 'open') {
        // A second Escape leaves the Open state, matching the × action.
        mapState.interface.closeResults();
      } else if (mapState.interface.view !== 'closed') {
        // On mobile with search view (not dock), Escape closes the search.
        mapState.interface.close(true);
      }
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
    if (!mapState.isMapReady) return;
    mapState.isSatelliteVisible = !mapState.isSatelliteVisible;
    setSatelliteVisible(mapState.map, mapState.isSatelliteVisible);
    elementById('satellite-toggle').setAttribute('aria-pressed', String(mapState.isSatelliteVisible));
    elementById('satellite-note').hidden = !mapState.isSatelliteVisible;
    renderCurrentAttribution();
    if (mapState.isSatelliteVisible) {
      placeSelection.close(false);
      mapState.hasExploredMap = true;
      const [west, south, east, north] = satelliteBounds;
      mapState.map.easeTo({
        center: [(west + east) / 2, (south + north) / 2],
        zoom: 17.5,
        duration: prefersReducedMotion ? 0 : 600
      });
    }
  });
  elementById('transport-toggle').addEventListener('click', () => {
    if (!mapState.transportFeed) return;
    const isEnabled = !mapState.transportFeed.isEnabled;
    if (!isEnabled && placeSelection.point?.kind === 'Bus stop') placeSelection.close(false);
    elementById('transport-toggle').setAttribute('aria-pressed', String(isEnabled));
    elementById('transport-info').hidden = !isEnabled;
    mapState.transportFeed.setEnabled(isEnabled);
    if (isEnabled) {
      placeSelection.close(false);
      mapState.hasExploredMap = true;
      mapState.map.easeTo({center: [19.26, 42.44], zoom: 12, duration: prefersReducedMotion ? 0 : 450});
      if (!navigator.onLine) mapState.transportFeed.pause('offline');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!mapState.transportFeed?.isEnabled) return;
    if (document.hidden) mapState.transportFeed.pause('paused');
    else if (navigator.onLine) mapState.transportFeed.refresh();
  });
  addEventListener('offline', () => mapState.transportFeed?.pause('offline'));
  addEventListener('online', () => {
    if (mapState.transportFeed?.isEnabled && !document.hidden) mapState.transportFeed.refresh();
  });
}

// Downloads and location actions report failures in the common visible error panel.
function registerDeviceControls() {
  elementById('retry').addEventListener('click', () => location.reload());
  elementById('dismiss-error').addEventListener('click', () => {
    elementById('error').hidden = true;
    mapState.interface.restoreFocus(elementById('search'));
  });
  elementById('position-action').addEventListener('click', () => locationControls.toggleFollowing());
  for (const eventType of ['online', 'offline']) {
    addEventListener(eventType, () => renderConnectionBadge(Boolean(startupState.archive?.local)));
  }
}

// Interface callbacks run after construction and always use the current selection.
function initializeInterface() {
  mapState.interface = new MapInterface({
    onSearch: () => {
      placeSelection.close(false);
      applyPlaceSearch();
    },
    onResultsRefreshed: () => {
      // Opening results or clearing a query is not a new search: keep the chosen place and refresh the list.
      applyPlaceSearch();
    },
    onChange: () => {
      // The footer can be hidden while its width is measured, so re-check the fit when the dock changes.
      renderCurrentAttribution();
      syncPanels();
      if (mapState.interface && mapState.interface.view !== 'closed' && !mapState.hasExploredMap) {
        mapState.hasExploredMap = true;
        locationControls.refresh();
      }
      if (mapState.interface?.view === 'closed') {
        placeSelection.clearRequestedPlace();
      }
    },
    // Recompute selection framing only after keyboard and camera changes have settled.
    onViewport: reason => placeSelection.viewportChanged(reason),
    onCardSwipedAway: () => placeSelection.close(),
    onResultsClosed: () => placeSelection.close(),
    onRemoveCategory: removeCategory,
    activeCategoryLabel: () => categories[directoryState.activeCategory] ?? '',
    // A Flip card opened from the dock returns to the same list; a map pick returns to the bare map.
    onFlipCardClosed: ({restoreDock}) => {
      placeSelection.close(false);
      if (restoreDock) mapState.interface.setView('dock');
    },
    resultsLabel: () => {
      const query = elementById('search').value.trim();
      const activeCategoryLabel = directoryState.activeCategory
        ? categories[directoryState.activeCategory]
        : 'All';
      if (query) return `${activeCategoryLabel} · “${query}”`;
      return activeCategoryLabel;
    }
  });
}

registerCategoryControls();
registerSelectionControls();
registerLayerControls();
registerDeviceControls();
initializeInterface();
trackDeviceClass();
trackFooterFit();
start().catch(error => {
  console.error(error);
  elementById('loading').hidden = true;
  notify(error.message || 'Map startup failed.');
});
