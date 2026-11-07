import {createElement, elementById} from './dom.js';
import {renderPlaceResults} from './place-details.js';
import {PlaceSelection} from './place-selection.js';
import {installCityNames, installPublicPlaceLayers} from './public-map-layers.js';
import {selectTappedFeature} from './map-selection.js';
import {OfflineControls, renderConnectionBadge} from './offline-controls.js';
import {transportStatusText} from './status-messages.js';
import {
  categories,
  matchesPlaceSearch,
  selectNearestPlaces,
  featureCollection,
  DEFAULT_CENTER,
  DISCOVER_ZOOM
} from './core.js';
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
  placeLayers
} from '@ivanov-gv/map-core';
import {ArchiveSource} from './offline.js';
import {installTransport, TransportFeed} from './transport.js';
import {
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
import {installPositionLayers} from './position.js';
import {LocationControls} from './location-controls.js';
import {MapInterface} from './interface.js';

// One map and the controllers installed on it.
const mapState = {
  map: null,
  isMapReady: false,
  hasExploredMap: false,
  shouldIgnoreNextMove: false,
  isSatelliteVisible: false,
  interface: null,
  objectSelection: null,
  routePlanner: null,
  transportFeed: null,
  errorTimer: null
};

// Loaded directory data and the active search, independent of the current selection.
const directoryState = {
  allPlaces: [],
  filteredPlaces: [],
  placesById: new Map(),
  activeCategory: 'all',
  buildingAddresses: new Map(),
  loadingError: null,
  visibilityConfig: null,
  markerKeysByPlaceId: new Map(),
  placeHitLayers: ['search-place'],
  searchTimer: null
};

// Host and offline adapters are created during startup and shared with their UI controller.
const startupState = {
  archive: null,
  dataMode: null,
  dataSources: null,
  serviceWorkerRegistration: null,
  offlineControls: null
};

const routeEndpoints = {from: null, to: null};

const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const placeSelection = new PlaceSelection({
  map: () => mapState.map,
  interface: () => mapState.interface,
  directory: () => directoryState,
  objectSelection: () => mapState.objectSelection,
  isMapReady: () => mapState.isMapReady,
  onExploreMap: () => {
    mapState.hasExploredMap = true;
  },
  onSelectionChanged: syncPanels,
  onResultsChanged: renderSearchResults,
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
  focusCoordinates: (coordinates, zoom, durationMilliseconds) =>
    placeSelection.focusCoordinates(coordinates, zoom, durationMilliseconds),
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
  elementById('route-endpoints').hidden =
    (!routeEndpoints.from && !routeEndpoints.to) ||
    mapState.interface?.view !== 'closed' ||
    !elementById('place-card').hidden;
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

// Rendering preserves focus when a camera move rebuilds rows after the selected card closes.
function renderSearchResults() {
  if (!mapState.map) return;
  const center = mapState.map.getCenter().toArray();
  const nearestPlaces = selectNearestPlaces(directoryState.filteredPlaces, center);
  const currentPlace = placeSelection.selectedPlace ?? placeSelection.previewPlace;
  renderPlaceResults({
    nearestPlaces,
    currentPlace,
    loadingError: directoryState.loadingError,
    onChoose: placeSelection.showPlace
  });
}

// A search or category narrows the candidates; matching icons keep their thresholds.
function applyPlaceSearch() {
  directoryState.filteredPlaces = directoryState.allPlaces.filter(feature =>
    matchesPlaceSearch(feature, elementById('search').value, directoryState.activeCategory)
  );
  if (mapState.isMapReady && !directoryState.loadingError)
    mapState.map
      .getSource('places')
      .setData(
        featureCollection(
          buildPlaceMarkers(directoryState.filteredPlaces, directoryState.markerKeysByPlaceId)
        )
      );
  placeSelection.onFilterChanged();
  renderSearchResults();
  placeSelection.previewResults();
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
      zoom: DISCOVER_ZOOM
    }
  });
  installPublicMapDebug();
  installPositionBadge();
  mapState.map.on('load', () => installPublicLayers(placesReady, labelsReady));
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
    }
  };
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
  mapState.map.on('movestart', event => {
    if (mapState.shouldIgnoreNextMove) {
      mapState.shouldIgnoreNextMove = false;
      return;
    }
    if (event.originalEvent && !mapState.hasExploredMap) {
      mapState.hasExploredMap = true;
      locationControls.refresh();
    }
  });
  // The list keeps its order while a chosen place is open, so the row just used does not jump.
  mapState.map.on('moveend', () => {
    if (!placeSelection.selectedPlace) renderSearchResults();
    placeSelection.flushPendingReveal();
  });
  installMapTaps(mapState.map, event =>
    selectTappedFeature(mapState.map, event, {
      isMapReady: mapState.isMapReady,
      placeHitLayers: directoryState.placeHitLayers,
      placesById: directoryState.placesById,
      buildingAddresses: directoryState.buildingAddresses,
      showPlace: placeSelection.showPlace,
      showPoint: placeSelection.showPoint,
      showChooser: placeSelection.showChooser
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

// Category toggles share the same filter and never move the camera.
function registerCategoryControls() {
  for (const [key, label] of Object.entries(categories)) {
    const button = createElement('button', label);
    button.type = 'button';
    button.dataset.category = key;
    button.setAttribute('aria-pressed', String(key === directoryState.activeCategory));
    button.addEventListener('click', () => {
      directoryState.activeCategory = directoryState.activeCategory === key ? 'all' : key;
      for (const other of elementById('categories').children) {
        const isActiveCategory = other.dataset.category === directoryState.activeCategory;
        other.setAttribute('aria-pressed', String(isActiveCategory));
        if (isActiveCategory) other.scrollIntoView({block: 'nearest', inline: 'nearest'});
      }
      applyPlaceSearch();
    });
    elementById('categories').append(button);
  }
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
  elementById('close-place').addEventListener('click', () => placeSelection.close());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!elementById('place-card').hidden) placeSelection.close();
      else mapState.interface.close(true);
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
  elementById('position-action').addEventListener('click', () => locationControls.requestPosition());
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
    onChange: () => {
      syncPanels();
      if (mapState.interface && mapState.interface.view !== 'closed' && !mapState.hasExploredMap) {
        mapState.hasExploredMap = true;
        locationControls.refresh();
      }
      if (mapState.interface?.view === 'closed') {
        placeSelection.clearPreview();
      }
    },
    // Recompute selection framing only after keyboard and camera changes have settled.
    onViewport: () => placeSelection.viewportChanged(),
    onCardSwipedAway: () => placeSelection.close(),
    resultsLabel: () => {
      const query = elementById('search').value.trim();
      return query
        ? `“${query}”`
        : directoryState.activeCategory === 'all'
          ? 'Results'
          : categories[directoryState.activeCategory];
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
