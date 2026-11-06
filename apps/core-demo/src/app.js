import {
  archiveFilenamePattern,
  createGeoJSONOverlay,
  createMap,
  defaultCenter,
  hitTest,
  installPlaces,
  offsetCoordinate,
  parseVisibilityConfig,
  registerArchiveProtocol,
  satelliteBounds,
  setSatelliteVisible,
  whenMapReady
} from '../../../packages/map-core/src/index.js';

const elementById = id => document.getElementById(id);
let map;
let overlay;
let places;
let visibilityConfig;
let archiveURL;
let overlayFeature;
let isSatelliteVisible = false;
let isOverlayVisible = true;
const overlayShiftPixels = 20;

// Errors stay visible even if only part of a map rendered successfully.
function showError(error) {
  elementById('error').textContent = error.message;
  elementById('error').hidden = false;
  elementById('status').textContent = 'Map needs attention';
}

async function loadJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

// Controls need a live map, so they stay disabled during startup and map recreation.
function setControlsEnabled(isEnabled) {
  for (const button of document.querySelectorAll('button')) {
    button.disabled = !isEnabled;
  }
}

// Shows the point itself, or the first ring corner once the overlay has become a polygon.
function updateOverlayReadout() {
  const {type, coordinates} = overlayFeature.geometry;
  const coordinate = type === 'Point' ? coordinates : coordinates[0][0];
  const coordinateDecimals = 6;
  elementById('coordinate').textContent = coordinate.map(value => value.toFixed(coordinateDecimals)).join(', ');
  elementById('geometry').textContent = type;
}

// A radius as large as the canvas makes the hit test count every marker currently on screen.
function updateMapReadouts() {
  elementById('camera').textContent = `Zoom ${map.getZoom().toFixed(1)}`;
  const {clientWidth, clientHeight} = map.getCanvas();
  const canvasCenter = {x: clientWidth / 2, y: clientHeight / 2};
  const placeIconLayers = map
    .getStyle()
    .layers.filter(layer => layer.id.startsWith('place-icons-'))
    .map(layer => layer.id);
  const visiblePlaces = hitTest(map, canvasCenter, placeIconLayers, Math.max(clientWidth, clientHeight));
  elementById('pois').textContent = `${places.features.length} source POIs · ${visiblePlaces.length} visible markers`;
}

// Recreating exercises the core's teardown without creating simultaneous maps or app dependencies.
async function createConceptMap() {
  setControlsEnabled(false);
  elementById('status').textContent = 'Loading local map…';
  elementById('error').hidden = true;
  map?.remove();
  map = null;
  isSatelliteVisible = false;
  isOverlayVisible = true;
  elementById('satellite').setAttribute('aria-pressed', 'false');
  elementById('overlay-toggle').setAttribute('aria-pressed', 'true');
  elementById('selection').textContent = 'Nothing selected';
  map = createMap({engine: maplibregl, container: 'map', basemapURL: archiveURL, assetBaseURL: location.href});
  // Exposed for browser tests and manual inspection, like the public app's kompasDebug.
  window.coreDemoDebug = {
    get map() {
      return map;
    }
  };
  map.on('error', event => showError(event.error ?? new Error('Map asset failed.')));
  await whenMapReady(map);
  installPlaces(map, places.features, visibilityConfig);
  overlayFeature = {
    type: 'Feature',
    id: 'concept',
    properties: {name: 'Concept overlay'},
    geometry: {type: 'Point', coordinates: [...defaultCenter]}
  };
  overlay = createGeoJSONOverlay(map, 'concept', {type: 'FeatureCollection', features: [overlayFeature]});
  map.on('click', selectOverlayAtClick);
  map.on('idle', updateMapReadouts);
  updateOverlayReadout();
  updateMapReadouts();
  if (elementById('error').hidden) elementById('status').textContent = 'Ready · core imports only';
  setControlsEnabled(true);
}

// A failed or stalled startup keeps the lifecycle control available, so retrying needs no reload.
async function recreateConceptMap() {
  try {
    await createConceptMap();
  } catch (error) {
    showError(error);
    elementById('recreate').disabled = false;
  }
}

function selectOverlayAtClick(event) {
  const feature = hitTest(map, event.point, overlay.layerIds)[0];
  overlay.setSelection(feature);
  elementById('selection').textContent = feature ? 'Concept overlay selected' : 'Nothing selected';
}

// Selection refers to the previous geometry, so any overlay change clears it.
function showOverlayFeature() {
  overlay.setData({type: 'FeatureCollection', features: [overlayFeature]});
  overlay.setSelection(null);
  elementById('selection').textContent = 'Nothing selected';
  updateOverlayReadout();
}

function replaceOverlayWithPolygon() {
  const [longitude, latitude] = defaultCenter;
  const halfWidthDegrees = 0.0005;
  const ring = [
    [longitude - halfWidthDegrees, latitude - halfWidthDegrees],
    [longitude + halfWidthDegrees, latitude - halfWidthDegrees],
    [longitude + halfWidthDegrees, latitude + halfWidthDegrees],
    [longitude - halfWidthDegrees, latitude + halfWidthDegrees],
    [longitude - halfWidthDegrees, latitude - halfWidthDegrees]
  ];
  overlayFeature.geometry = {type: 'Polygon', coordinates: [ring]};
  showOverlayFeature();
}

// A polygon returns to a point first, because projection shifts a single coordinate.
function shiftOverlay() {
  if (overlayFeature.geometry.type !== 'Point') {
    overlayFeature.geometry = {type: 'Point', coordinates: [...defaultCenter]};
  }
  overlayFeature.geometry.coordinates = offsetCoordinate(
    map,
    overlayFeature.geometry.coordinates,
    overlayShiftPixels,
    0
  );
  showOverlayFeature();
}

function toggleSatellite() {
  isSatelliteVisible = !isSatelliteVisible;
  setSatelliteVisible(map, isSatelliteVisible);
  elementById('satellite').setAttribute('aria-pressed', String(isSatelliteVisible));
  if (isSatelliteVisible) map.fitBounds(satelliteBounds, {duration: 0, padding: 20});
}

function toggleOverlay() {
  isOverlayVisible = !isOverlayVisible;
  overlay.setVisible(isOverlayVisible);
  elementById('overlay-toggle').setAttribute('aria-pressed', String(isOverlayVisible));
}

function clearOverlaySelection() {
  overlay.setSelection(null);
  elementById('selection').textContent = 'Nothing selected';
}

// Handlers read the current map, so they stay valid when the map is recreated.
function registerConceptControls() {
  elementById('reset').onclick = () => map.jumpTo({center: defaultCenter, zoom: 15, bearing: 0, pitch: 0});
  elementById('recreate').onclick = recreateConceptMap;
  elementById('satellite').onclick = toggleSatellite;
  elementById('overview').onclick = () => map.jumpTo({center: defaultCenter, zoom: 12});
  elementById('street').onclick = () => map.jumpTo({center: defaultCenter, zoom: 16});
  elementById('shift').onclick = shiftOverlay;
  elementById('replace').onclick = replaceOverlayWithPolygon;
  elementById('overlay-toggle').onclick = toggleOverlay;
  elementById('clear-selection').onclick = clearOverlaySelection;
}

// Loads shared inputs once; only the map itself is recreated by the lifecycle control.
async function start() {
  const [mapMetadata, sourcePlaces, rawVisibilityConfig] = await Promise.all([
    loadJSON('data/map.json'),
    loadJSON('data/places.geojson'),
    loadJSON('data/place-visibility.json')
  ]);
  places = sourcePlaces;
  if (!archiveFilenamePattern.test(mapMetadata.archive)) throw new Error('Invalid map archive metadata.');
  visibilityConfig = parseVisibilityConfig(rawVisibilityConfig);
  archiveURL = 'pmtiles://' + new URL(`data/${mapMetadata.archive}`, location.href).href;
  registerArchiveProtocol(maplibregl, pmtiles);
  registerConceptControls();
  await recreateConceptMap();
}

start().catch(showError);
