import {DirectionTracker} from './vehicle-direction.js';
import {RELAY_URL} from './data-mode.js';
export const TRANSPORT_INTERVAL_MILLISECONDS = 13000;
const maximumFeedAgeMilliseconds = 60000;
const maximumFeedFeatures = 2000;
const futureCheckToleranceMilliseconds = 30000;
const maximumRouteNameLength = 32;
const requestTimeoutMilliseconds = 10000;
const coverageBounds = {west: 17.8, east: 21, south: 41.3, north: 44.1};
const empty = () => ({type: 'FeatureCollection', features: []});

// Validate relay coordinates, freshness and optional movement metadata before they reach the map.
export function validTransportFeed(feedSnapshot, nowMilliseconds = Date.now()) {
  const hasValidCollection =
    feedSnapshot?.type === 'FeatureCollection' &&
    Array.isArray(feedSnapshot.features) &&
    feedSnapshot.features.length <= maximumFeedFeatures;
  if (!hasValidCollection) throw new Error('Invalid transport response');
  const checkedAtMilliseconds = Date.parse(feedSnapshot.fetchedAt);
  const hasFreshCheck =
    Number.isFinite(checkedAtMilliseconds) &&
    checkedAtMilliseconds <= nowMilliseconds + futureCheckToleranceMilliseconds &&
    nowMilliseconds - checkedAtMilliseconds <= maximumFeedAgeMilliseconds;
  if (!hasFreshCheck) throw new Error('Transport feed has expired');
  for (const feature of feedSnapshot.features) validateVehicle(feature);
  return feedSnapshot;
}

// Unknown bearings stay unknown: a present bearing must carry the movement heading tag too.
function validateVehicle(feature) {
  const point = feature?.geometry?.coordinates;
  const isPointFeature = feature?.type === 'Feature' && feature.geometry?.type === 'Point';
  const hasCoordinate = Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const isInsideCoverage =
    hasCoordinate &&
    point[0] >= coverageBounds.west &&
    point[0] <= coverageBounds.east &&
    point[1] >= coverageBounds.south &&
    point[1] <= coverageBounds.north;
  const route = feature?.properties?.route;
  const hasRouteName = typeof route === 'string' && route.length <= maximumRouteNameLength;
  if (!isPointFeature || !isInsideCoverage || !hasRouteName) throw new Error('Invalid bus position');
  const {bearing, heading} = feature.properties;
  const hasDirection = bearing !== undefined || heading !== undefined;
  const isMovementDirection =
    Number.isFinite(bearing) && bearing >= 0 && bearing < 360 && heading === 'movement';
  if (hasDirection && !isMovementDirection) throw new Error('Invalid bus direction');
}

export function installTransport(map) {
  map.addSource('transport-stops', {type: 'geojson', data: 'data/transport-stops.geojson'});
  map.addLayer({
    id: 'transport-stops',
    type: 'circle',
    source: 'transport-stops',
    minzoom: 13,
    layout: {visibility: 'none'},
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 5,
      'circle-stroke-color': '#195c9e',
      'circle-stroke-width': 2
    }
  });
  map.addLayer({
    id: 'transport-stop-names',
    type: 'symbol',
    source: 'transport-stops',
    minzoom: 16,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-max-width': 14
    },
    paint: {'text-color': '#195c9e', 'text-halo-color': '#ffffff', 'text-halo-width': 2}
  });
  map.addSource('transport', {type: 'geojson', data: empty()});
  map.addImage('bus-arrow', busIcon({arrow: true}), {pixelRatio: 2});
  map.addImage('bus-estimate', busIcon({arrow: true, estimate: true}), {pixelRatio: 2});
  map.addImage('bus-plain', busIcon({arrow: false}), {pixelRatio: 2});
  // The point shows the direction of travel and turns with the map: solid from movement, outlined when
  // estimated from the route (a street's two directions cannot be told apart before the bus moves).
  map.addLayer({
    id: 'transport-buses',
    type: 'symbol',
    source: 'transport',
    layout: {
      visibility: 'none',
      'icon-image': [
        'match',
        ['get', 'heading'],
        'movement',
        'bus-arrow',
        'route',
        'bus-estimate',
        'bus-plain'
      ],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true
    }
  });
  map.addLayer({
    id: 'transport-routes',
    type: 'symbol',
    source: 'transport',
    layout: {
      visibility: 'none',
      'text-field': ['get', 'route'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 11,
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: {'text-color': ['match', ['get', 'heading'], 'route', '#195c9e', '#ffffff']}
  });
}

// Disc for the route number, centred in the image so the label stays inside it. With arrow, the disc
// becomes a teardrop whose point (north before rotation) shows the direction of travel. An estimate
// is drawn as a white teardrop with a blue outline instead of solid blue.
function busIcon({arrow, estimate = false}) {
  const radiusPixels = 26;
  const tipPixels = 2 * radiusPixels;
  const strokePixels = 4;
  const centerPixels = tipPixels + strokePixels;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 2 * centerPixels;
  const context = canvas.getContext('2d');
  const shape = () => {
    context.beginPath();
    if (!arrow) {
      context.arc(centerPixels, centerPixels, radiusPixels, 0, Math.PI * 2);
      return;
    }
    // Tangents from the point to the disc meet it 60 degrees either side of north when tipPixels = 2 * radiusPixels.
    const spreadRadians = Math.acos(radiusPixels / tipPixels);
    const northAngleRadians = -Math.PI / 2;
    context.moveTo(centerPixels, centerPixels - tipPixels);
    context.arc(
      centerPixels,
      centerPixels,
      radiusPixels,
      northAngleRadians + spreadRadians,
      northAngleRadians - spreadRadians + Math.PI * 2
    );
    context.closePath();
  };
  context.lineJoin = 'round';
  shape();
  context.lineWidth = 2 * strokePixels;
  context.strokeStyle = estimate ? '#195c9e' : '#ffffff';
  context.stroke();
  shape();
  context.fillStyle = estimate ? '#ffffff' : '#195c9e';
  context.fill();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

export class TransportFeed {
  constructor(
    map,
    {
      url = RELAY_URL,
      networkURL = 'data/transit-network.json',
      directions = new DirectionTracker(),
      fetchImpl = (...argumentsList) => fetch(...argumentsList),
      onStatus = () => {},
      now = Date.now,
      schedule = (...argumentsList) => setTimeout(...argumentsList),
      cancel = (timer) => clearTimeout(timer)
    } = {}
  ) {
    Object.assign(this, {map, url, networkURL, directions, fetchImpl, onStatus, now, schedule, cancel});
    this.isEnabled = false;
    this.generation = 0;
    this.snapshot = null;
    this.network = null;
  }
  // Route shapes for estimating the direction of buses that have not moved yet. Without them,
  // direction comes from movement only; the failure is reported, the feed keeps working.
  loadNetwork() {
    this.network ??= this.fetchImpl(this.networkURL)
      .then(async (response) => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        this.directions.setNetwork(await response.json());
      })
      .catch((error) => {
        console.error('Bus route shapes unavailable; directions use movement only', error);
        this.network = null;
      });
    return this.network;
  }
  clearTimer() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }
  visible(isVisible) {
    for (const layerId of ['transport-stops', 'transport-stop-names', 'transport-buses', 'transport-routes'])
      this.map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
  }
  setEnabled(isEnabled) {
    this.isEnabled = isEnabled;
    this.generation++;
    this.clearTimer();
    this.controller?.abort();
    this.snapshot = null;
    this.directions.reset();
    this.map.getSource('transport').setData(empty());
    this.visible(isEnabled);
    this.onStatus({state: isEnabled ? 'loading' : 'off', count: 0});
    if (isEnabled) return this.refresh();
  }
  pause(reason = 'offline') {
    this.generation++;
    this.clearTimer();
    this.controller?.abort();
    this.snapshot = null;
    this.directions.reset();
    this.map.getSource('transport').setData(empty());
    if (this.isEnabled) this.onStatus({state: reason, count: 0});
  }
  async refresh() {
    if (!this.isEnabled) return;
    this.clearTimer();
    this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = this.schedule(() => controller.abort(), requestTimeoutMilliseconds);
    try {
      const [response] = await Promise.all([
        this.fetchImpl(this.url, {signal: this.controller.signal, credentials: 'omit', cache: 'no-store'}),
        this.loadNetwork()
      ]);
      if (!response.ok) throw new Error('Bus feed unavailable');
      const data = validTransportFeed(await response.json(), this.now());
      if (!this.isEnabled || generation !== this.generation) return;
      this.snapshot = data;
      this.map.getSource('transport').setData({
        type: 'FeatureCollection',
        features: this.directions.update(data.features, Date.parse(data.fetchedAt))
      });
      this.onStatus({
        state: data.stale ? 'stale' : 'live',
        count: data.features.length,
        fetchedAt: data.fetchedAt
      });
    } catch {
      if (!this.isEnabled || generation !== this.generation) return;
      const stillUsable =
        this.snapshot && this.now() - Date.parse(this.snapshot.fetchedAt) <= maximumFeedAgeMilliseconds;
      if (!stillUsable) {
        this.snapshot = null;
        this.map.getSource('transport').setData(empty());
      }
      this.onStatus({
        state: stillUsable ? 'stale' : 'unavailable',
        count: this.snapshot?.features.length ?? 0,
        fetchedAt: this.snapshot?.fetchedAt
      });
    } finally {
      this.cancel(timeout);
      if (this.isEnabled && generation === this.generation)
        this.timer = this.schedule(() => this.refresh(), TRANSPORT_INTERVAL_MILLISECONDS);
    }
  }
}
