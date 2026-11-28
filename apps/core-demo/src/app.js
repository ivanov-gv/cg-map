import {
  archiveFilenamePattern,
  createGeoJSONOverlay,
  createMap,
  defaultCenter,
  hitTest,
  installPlaces,
  offsetCoordinate,
  parseVisibilityConfig,
  placeVisibilityLevel,
  registerArchiveProtocol,
  satelliteBounds,
  setSatelliteVisible,
  whenMapReady
} from '@ivanov-gv/map-core';

const elementById = id => document.getElementById(id);
let map;
let overlay;
let places;
let visibilityConfig;
let archiveURL;
let overlayFeature;
let resolvedVisibilitySamples = [];
let isSatelliteVisible = false;
let isOverlayVisible = true;
let isOverlayEditable = false;
const overlayShiftPixels = 20;

// Version-5 samples have a stable identity and no stored level, so the policy or an override must resolve them.
// They sit outside the default view: today's map looks unchanged until a control button moves the camera to one.
export const demoVisibilitySamples = [
  {
    id: 'kind-band',
    label: 'Kind rule · museum',
    feature: {
      type: 'Feature',
      properties: {entityId: 'demo/kind-band', kind: 'museum', name: 'Kind-band sample'},
      geometry: {type: 'Point', coordinates: [19.56, 42.11]}
    }
  },
  {
    id: 'override-band',
    label: 'visibilityOverride · 4',
    feature: {
      type: 'Feature',
      properties: {
        entityId: 'demo/override-band',
        kind: 'museum',
        name: 'Override-band sample',
        visibilityOverride: 4
      },
      geometry: {type: 'Point', coordinates: [19.58, 42.11]}
    }
  }
];

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

// Parses the data-owned policy once, then states the level each sample POI will use when it is installed.
export function resolveDemoVisibility(rawConfig, policy) {
  const config = parseVisibilityConfig(rawConfig, policy);
  const samples = demoVisibilitySamples.map(sample => {
    const level = placeVisibilityLevel(sample.feature, config);
    return {
      id: sample.id,
      label: sample.label,
      level,
      zoom: config.thresholds.get(level),
      coordinates: [...sample.feature.geometry.coordinates]
    };
  });
  return {config, samples};
}

function showVisibilitySamples(samples) {
  resolvedVisibilitySamples = samples;
  const descriptions = samples.map(sample => `${sample.label}: level ${sample.level} · zoom ${sample.zoom}`);
  elementById('zoom-bands').textContent = descriptions.join(' · ');
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
  isOverlayEditable = false;
  elementById('overlay-editable').setAttribute('aria-pressed', 'false');
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
  const sampleFeatures = demoVisibilitySamples.map(sample => sample.feature);
  installPlaces(map, [...places.features, ...sampleFeatures], visibilityConfig);
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

// Editable is the Editor's state for objects that can be edited; the selection stays Highlighted either way.
function toggleOverlayEditable() {
  isOverlayEditable = !isOverlayEditable;
  overlay.setState(isOverlayEditable ? 'editable' : 'default');
  elementById('overlay-editable').setAttribute('aria-pressed', String(isOverlayEditable));
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
  elementById('overlay-editable').onclick = toggleOverlayEditable;
  elementById('clear-selection').onclick = clearOverlaySelection;
  for (const sample of resolvedVisibilitySamples) {
    elementById(sample.id).onclick = () => map.jumpTo({center: sample.coordinates, zoom: sample.zoom});
  }
}

// Loads shared inputs once; only the map itself is recreated by the lifecycle control.
async function start() {
  const [mapMetadata, sourcePlaces, rawVisibilityConfig, rawVisibilityPolicy] = await Promise.all([
    loadJSON('data/map.json'),
    loadJSON('data/places.geojson'),
    loadJSON('data/place-visibility.json'),
    loadJSON('data/place-visibility-policy.json')
  ]);
  places = sourcePlaces;
  if (!archiveFilenamePattern.test(mapMetadata.archive)) throw new Error('Invalid map archive metadata.');
  const {config, samples} = resolveDemoVisibility(rawVisibilityConfig, rawVisibilityPolicy);
  visibilityConfig = config;
  showVisibilitySamples(samples);
  archiveURL = 'pmtiles://' + new URL(`data/${mapMetadata.archive}`, location.href).href;
  registerArchiveProtocol(maplibregl, pmtiles);
  registerConceptControls();
  await recreateConceptMap();
}

// Consumer tests import the resolver without a DOM; only a browser starts the app.
if (typeof document !== 'undefined') start().catch(showError);
