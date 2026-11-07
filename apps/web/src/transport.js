// Optional live transport: bus stops, and vehicle positions polled from the relay or the Kompas server while enabled.
// Positions are shown only while fresh and are never stored.
import {DirectionTracker} from './vehicle-direction.js';
import {RELAY_URL} from './data-mode.js';

const refreshIntervalMilliseconds = 13000;
// A snapshot older than this is no longer shown, even as stale.
const maxSnapshotAgeMilliseconds = 60000;
// A feed time this far ahead of the device clock is not believable.
const maxClockAheadMilliseconds = 30000;
const requestTimeoutMilliseconds = 10000;
const maxVehicles = 2000;
const maxRouteNameLength = 32;
// [[west, south], [east, north]] around Montenegro; a position outside is a GPS error.
const serviceArea = [
  [17.8, 41.3],
  [21, 44.1]
];
const transportLayers = ['transport-stops', 'transport-stop-names', 'transport-buses', 'transport-routes'];
const busColor = '#195c9e';

const emptyCollection = () => ({type: 'FeatureCollection', features: []});

function isInServiceArea(point) {
  const [[west, south], [east, north]] = serviceArea;
  return point[0] >= west && point[0] <= east && point[1] >= south && point[1] <= north;
}

function isValidVehiclePosition(feature) {
  const point = feature?.geometry?.coordinates;
  const isPoint = feature?.type === 'Feature' && feature.geometry?.type === 'Point';
  const isCoordinatePair = Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  const route = feature?.properties?.route;
  const hasRoute = typeof route === 'string' && route.length <= maxRouteNameLength;
  return isPoint && isCoordinatePair && isInServiceArea(point) && hasRoute;
}

// A direction is optional, but when present it is a movement bearing in [0, 360).
function isValidDirection({bearing, heading}) {
  if (bearing === undefined && heading === undefined) return true;
  return Number.isFinite(bearing) && bearing >= 0 && bearing < 360 && heading === 'movement';
}

// Returns the feed unchanged, or throws when it is malformed, expired or not believable. now is in milliseconds.
export function validTransportFeed(value, now = Date.now()) {
  const isCollection = value?.type === 'FeatureCollection' && Array.isArray(value.features);
  if (!isCollection || value.features.length > maxVehicles) throw new Error('Invalid transport response');
  const fetchedAt = Date.parse(value.fetchedAt);
  const isCurrent =
    Number.isFinite(fetchedAt) &&
    fetchedAt <= now + maxClockAheadMilliseconds &&
    now - fetchedAt <= maxSnapshotAgeMilliseconds;
  if (!isCurrent) throw new Error('Transport feed has expired');
  for (const feature of value.features) {
    if (!isValidVehiclePosition(feature)) throw new Error('Invalid bus position');
    if (!isValidDirection(feature.properties)) throw new Error('Invalid bus direction');
  }
  return value;
}

// Adds the stop and vehicle layers, hidden until TransportFeed enables them.
export function installTransport(map) {
  map.addSource('transport-stops', {type: 'geojson', data: 'data/transport-stops.geojson'});
  map.addLayer({
    id: 'transport-stops',
    type: 'circle',
    source: 'transport-stops',
    minzoom: 13,
    layout: {visibility: 'none'},
    paint: {'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': busColor, 'circle-stroke-width': 2}
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
    paint: {'text-color': busColor, 'text-halo-color': '#ffffff', 'text-halo-width': 2}
  });
  map.addSource('transport', {type: 'geojson', data: emptyCollection()});
  map.addImage('bus-arrow', busIcon({hasArrow: true}), {pixelRatio: 2});
  map.addImage('bus-estimate', busIcon({hasArrow: true, isEstimate: true}), {pixelRatio: 2});
  map.addImage('bus-plain', busIcon({hasArrow: false}), {pixelRatio: 2});
  // The point shows the direction of travel and turns with the map: solid from movement, outlined when
  // estimated from the route (a street's two directions cannot be told apart before the bus moves).
  map.addLayer({
    id: 'transport-buses',
    type: 'symbol',
    source: 'transport',
    layout: {
      visibility: 'none',
      'icon-image': ['match', ['get', 'heading'], 'movement', 'bus-arrow', 'route', 'bus-estimate', 'bus-plain'],
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
    paint: {'text-color': ['match', ['get', 'heading'], 'route', busColor, '#ffffff']}
  });
}

// Disc for the route number, centred in the image so the label stays inside it. With an arrow, the disc
// becomes a teardrop whose point (north before rotation) shows the direction of travel. An estimate
// is drawn as a white teardrop with a blue outline instead of solid blue.
function busIcon({hasArrow, isEstimate = false}) {
  const radius = 26;
  const tipDistance = 2 * radius;
  const strokeWidth = 4;
  const center = tipDistance + strokeWidth;
  const canvas = document.createElement('canvas');
  canvas.width = 2 * center;
  canvas.height = 2 * center;
  const context = canvas.getContext('2d');
  const tracePath = () => {
    context.beginPath();
    if (!hasArrow) {
      context.arc(center, center, radius, 0, Math.PI * 2);
      return;
    }
    // Tangents from the point to the disc meet it 60 degrees either side of north when tipDistance = 2 * radius.
    const spread = Math.acos(radius / tipDistance);
    const north = -Math.PI / 2;
    context.moveTo(center, center - tipDistance);
    context.arc(center, center, radius, north + spread, north - spread + Math.PI * 2);
    context.closePath();
  };
  context.lineJoin = 'round';
  tracePath();
  context.lineWidth = 2 * strokeWidth;
  context.strokeStyle = isEstimate ? busColor : '#ffffff';
  context.stroke();
  tracePath();
  context.fillStyle = isEstimate ? '#ffffff' : busColor;
  context.fill();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Polls the vehicle feed while enabled and reports {state, count, fetchedAt} through onStatus. Every refresh bumps
// a generation, so a response that arrives after a newer request, a pause or disabling is ignored.
export class TransportFeed {
  constructor(
    map,
    {
      url = RELAY_URL,
      networkURL = 'data/transit-network.json',
      directions = new DirectionTracker(),
      fetchImpl = (...args) => fetch(...args),
      onStatus = () => {},
      now = Date.now,
      schedule = (...args) => setTimeout(...args),
      cancel = timer => clearTimeout(timer)
    } = {}
  ) {
    Object.assign(this, {map, url, networkURL, directions, fetchImpl, onStatus, now, schedule, cancel});
    this.enabled = false;
    this.generation = 0;
    this.snapshot = null;
    this.network = null;
  }

  // Route shapes for estimating the direction of buses that have not moved yet. Without them,
  // direction comes from movement only; the failure is reported, the feed keeps working.
  loadNetwork() {
    this.network ??= this.fetchImpl(this.networkURL)
      .then(async response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        this.directions.setNetwork(await response.json());
      })
      .catch(error => {
        console.error('Bus route shapes unavailable; directions use movement only', error);
        this.network = null;
      });
    return this.network;
  }

  clearTimer() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }

  setLayersVisible(isVisible) {
    for (const id of transportLayers) this.map.setLayoutProperty(id, 'visibility', isVisible ? 'visible' : 'none');
  }

  // Stops any request in flight and forgets every position and direction.
  #reset() {
    this.generation++;
    this.clearTimer();
    this.controller?.abort();
    this.snapshot = null;
    this.directions.reset();
    this.map.getSource('transport').setData(emptyCollection());
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.#reset();
    this.setLayersVisible(enabled);
    this.onStatus({state: enabled ? 'loading' : 'off', count: 0});
    if (enabled) return this.refresh();
  }

  // reason is the state to report: 'offline' or 'paused'.
  pause(reason = 'offline') {
    this.#reset();
    if (this.enabled) this.onStatus({state: reason, count: 0});
  }

  async refresh() {
    if (!this.enabled) return;
    this.clearTimer();
    this.controller?.abort();
    const generation = ++this.generation;
    const isCurrent = () => this.enabled && generation === this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const timeout = this.schedule(() => controller.abort(), requestTimeoutMilliseconds);
    try {
      const request = this.fetchImpl(this.url, {signal: controller.signal, credentials: 'omit', cache: 'no-store'});
      const [response] = await Promise.all([request, this.loadNetwork()]);
      if (!response.ok) throw new Error('Bus feed unavailable');
      const data = validTransportFeed(await response.json(), this.now());
      if (!isCurrent()) return;
      this.#show(data);
    } catch {
      if (!isCurrent()) return;
      this.#showLastSnapshot();
    } finally {
      this.cancel(timeout);
      if (isCurrent()) this.timer = this.schedule(() => this.refresh(), refreshIntervalMilliseconds);
    }
  }

  #show(data) {
    this.snapshot = data;
    const vehicles = this.directions.update(data.features, Date.parse(data.fetchedAt));
    this.map.getSource('transport').setData({type: 'FeatureCollection', features: vehicles});
    this.onStatus({state: data.stale ? 'stale' : 'live', count: data.features.length, fetchedAt: data.fetchedAt});
  }

  // After a failed refresh the last snapshot stays on the map as stale while it is young enough, then disappears.
  #showLastSnapshot() {
    const snapshotAge = this.snapshot ? this.now() - Date.parse(this.snapshot.fetchedAt) : Infinity;
    const isStillUsable = snapshotAge <= maxSnapshotAgeMilliseconds;
    if (!isStillUsable) {
      this.snapshot = null;
      this.map.getSource('transport').setData(emptyCollection());
    }
    this.onStatus({
      state: isStillUsable ? 'stale' : 'unavailable',
      count: this.snapshot?.features.length ?? 0,
      fetchedAt: this.snapshot?.fetchedAt
    });
  }
}
