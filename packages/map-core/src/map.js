import {mapStyle, installBuildingNumberScale} from './map-style.js';
import {installSatellite} from './satellite.js';

const mapStates = new WeakMap();

// Inside the satellite sample, so every capability is visible on open. Apps may pass their own center.
export const defaultCenter = [19.259, 42.442];
export const mapBounds = [
  [17.8, 41.3],
  [21, 44.1]
];
// Release archives are content-addressed; anything else in map metadata is rejected before use.
export const archiveFilenamePattern = /^montenegro-[a-f0-9]{16}\.pmtiles$/;
const defaultStartupTimeoutMilliseconds = 20000;

// Engines and archive readers are injected: applications own transport and offline policy.
export function registerArchiveProtocol(engine, archiveEngine, archiveSource) {
  const protocol = new archiveEngine.Protocol();
  if (archiveSource) protocol.add(new archiveEngine.PMTiles(archiveSource));
  engine.addProtocol('pmtiles', protocol.tile);
  return protocol;
}

// Creates one shared map and removes its resize observer and scale listeners on teardown.
// The caller must supply local asset URLs and handle map errors visibly in its own UI.
export function createMap({engine, container, basemapURL, assetBaseURL, options = {}}) {
  if (!engine?.Map) throw new Error('The local MapLibre engine is unavailable.');
  const map = new engine.Map({
    container,
    style: mapStyle(basemapURL, assetBaseURL),
    center: defaultCenter,
    zoom: 15,
    minZoom: 7,
    maxZoom: 23,
    maxBounds: mapBounds,
    renderWorldCopies: false,
    attributionControl: {compact: true},
    fadeDuration: 0,
    maxTileCacheSize: 160,
    pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 2),
    refreshExpiredTiles: false,
    ...options
  });
  mapStates.set(map, 'loading');
  map.addControl(new engine.NavigationControl({showCompass: false}), 'bottom-right');
  map.addControl(new engine.ScaleControl({maxWidth: 100}), 'bottom-left');
  // Resize on the next frame, once per frame, so layout settles first and no callback outlives the map.
  let resizeFrame;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => map.resize());
  });
  observer.observe(map.getContainer());
  let stopNumberScale;
  map.once('load', () => {
    stopNumberScale = installBuildingNumberScale(map);
    installSatellite(map, assetBaseURL);
    mapStates.set(map, 'ready');
  });
  map.once('remove', () => {
    mapStates.set(map, 'removed');
    observer.disconnect();
    cancelAnimationFrame(resizeFrame);
    stopNumberScale?.();
  });
  return map;
}

// Restrict hit testing to installed layers, so optional overlays can be absent safely.
export function hitTest(map, point, layerIds, radiusPixels = 5) {
  const layers = layerIds.filter(layerId => map.getLayer(layerId));
  if (!layers.length) return [];
  const bounds = [
    [point.x - radiusPixels, point.y - radiusPixels],
    [point.x + radiusPixels, point.y + radiusPixels]
  ];
  return map.queryRenderedFeatures(bounds, {layers});
}

// Convert a relative screen drag into geography without snapping to the finger/contact point.
export function offsetCoordinate(map, coordinate, horizontalPixels, verticalPixels) {
  const start = map.project(coordinate);
  const destination = map.unproject([start.x + horizontalPixels, start.y + verticalPixels]);
  return destination.toArray();
}

// Reject stalled startup or removal instead of leaving a consumer's loading state forever.
export function whenMapReady(map, timeoutMilliseconds = defaultStartupTimeoutMilliseconds) {
  if (mapStates.get(map) === 'ready') return Promise.resolve(map);
  if (mapStates.get(map) === 'removed') return Promise.reject(new Error('Map has been removed.'));
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer);
      map.off('load', resolveOnLoad);
      map.off('remove', rejectOnRemoval);
      if (error) reject(error);
      else resolve(map);
    };
    const resolveOnLoad = () => finish();
    const rejectOnRemoval = () => finish(new Error('Map removed before startup completed.'));
    const timer = setTimeout(
      () => finish(new Error('Map startup timed out. Check local assets and WebGL.')),
      timeoutMilliseconds
    );
    map.once('load', resolveOnLoad);
    map.once('remove', rejectOnRemoval);
  });
}
