import {classifyFix, accuracyCircle, POSITION_FRESH_MILLISECONDS, POSITION_TIMEOUT_MILLISECONDS} from './core.js';

// How often a held fix is re-classified, so it turns stale without a new browser report.
const evaluateEveryMilliseconds = 5000;
// GeolocationPositionError codes.
const permissionDeniedCode = 1;
const positionUnavailableCode = 2;
const timeoutCode = 3;

// Current position for Discover (docs/ui-ux/discover.md D-06). Coordinates stay in this object only: they are never
// stored, cached, logged or sent anywhere by the app. The browser/OS location provider may use its own services.
// onChange receives a snapshot {state, fix, age} after every state change.
export class PositionTracker {
  constructor({
    bounds,
    onChange,
    geolocation = globalThis.navigator?.geolocation,
    permissions = globalThis.navigator?.permissions,
    secure = globalThis.isSecureContext,
    now = Date.now,
    every = (callback, milliseconds) => setInterval(callback, milliseconds)
  }) {
    Object.assign(this, {bounds, onChange, geolocation, permissions, secure, now, every});
    this.fix = null;
    this.watchId = null;
    this.permission = 'unknown';
    this.state = 'idle';
    this.error = null;
  }

  async start() {
    if (!this.secure) return this.set('insecure');
    if (!this.geolocation) return this.set('unsupported');
    this.every(() => this.evaluate(), evaluateEveryMilliseconds);
    await this.#followPermission();
    if (this.permission === 'denied') return this.set('denied');
    // Granted: no extra click. Prompt: the browser asks now; if it suppresses the prompt the visible action retries.
    this.watch();
  }

  // A browser without the Permissions API still asks for location directly.
  async #followPermission() {
    try {
      const status = await this.permissions?.query({name: 'geolocation'});
      if (!status) return;
      this.permission = status.state;
      status.addEventListener?.('change', () => {
        this.permission = status.state;
        if (status.state === 'denied') {
          this.stop();
          this.set('denied');
        } else if (status.state === 'granted' && this.watchId === null) {
          this.watch();
        }
      });
    } catch (error) {
      console.warn('Permissions API unavailable; asking for location directly', error);
    }
  }

  watch() {
    this.stop();
    this.error = null;
    this.set(this.permission === 'prompt' ? 'prompt' : 'acquiring');
    const options = {
      enableHighAccuracy: true,
      timeout: POSITION_TIMEOUT_MILLISECONDS,
      maximumAge: POSITION_FRESH_MILLISECONDS
    };
    this.watchId = this.geolocation.watchPosition(
      position => this.update(position),
      error => this.fail(error),
      options
    );
  }

  stop() {
    if (this.watchId !== null) this.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  retry() {
    if (this.secure && this.geolocation) this.watch();
  }

  update({coords, timestamp}) {
    const isValid = [coords?.longitude, coords?.latitude, coords?.accuracy].every(Number.isFinite);
    if (!isValid) return this.fail({code: positionUnavailableCode, message: 'Invalid position'});
    this.fix = {
      coordinates: [coords.longitude, coords.latitude],
      accuracy: coords.accuracy,
      timestamp: timestamp ?? this.now()
    };
    this.error = null;
    this.evaluate();
  }

  fail(error) {
    // Code 1 also covers a dismissed prompt; only a recorded browser block counts as denied (and gets no retry).
    if (error.code === permissionDeniedCode) {
      this.stop();
      this.fix = null;
      return this.set(this.permission === 'denied' ? 'denied' : 'prompt');
    }
    // Keep a previous fix visible but let evaluate() mark it stale; without one, name the condition.
    this.error = error.code === timeoutCode ? 'timeout' : 'unavailable';
    this.evaluate();
  }

  evaluate() {
    if (this.fix) return this.set(classifyFix(this.fix, this.now(), this.bounds));
    if (this.error) this.set(this.error);
  }

  set(state) {
    this.state = state;
    this.onChange?.(this.snapshot());
  }

  // A copy, so a listener cannot change the tracked fix. age is milliseconds since the fix, or null without one.
  snapshot() {
    const fix = this.fix ? {...this.fix, coordinates: [...this.fix.coordinates]} : null;
    const age = this.fix ? this.now() - this.fix.timestamp : null;
    return {state: this.state, fix, age};
  }
}

// The accuracy ring and dot, drawn grey once the fix is stale. Nothing is drawn without a fix or outside the map.
export function positionFeatures({state, fix}) {
  if (!fix || state === 'outside') return {type: 'FeatureCollection', features: []};
  const displayState = ['live', 'approximate', 'stale'].includes(state) ? state : 'stale';
  const accuracy = {
    type: 'Feature',
    geometry: accuracyCircle(fix.coordinates, fix.accuracy),
    properties: {part: 'accuracy', state: displayState}
  };
  const position = {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [...fix.coordinates]},
    properties: {part: 'position', state: displayState}
  };
  return {type: 'FeatureCollection', features: [accuracy, position]};
}

export function installPositionLayers(map) {
  map.addSource('position', {type: 'geojson', data: positionFeatures({})});
  const isStale = ['==', ['get', 'state'], 'stale'];
  const positionColor = ['case', isStale, '#7d8790', '#1f6fd1'];
  const isAccuracy = ['==', ['get', 'part'], 'accuracy'];
  map.addLayer({
    id: 'position-accuracy',
    type: 'fill',
    source: 'position',
    filter: isAccuracy,
    paint: {'fill-color': positionColor, 'fill-opacity': 0.1}
  });
  map.addLayer({
    id: 'position-accuracy-edge',
    type: 'line',
    source: 'position',
    filter: isAccuracy,
    paint: {'line-color': positionColor, 'line-width': 1.5, 'line-opacity': 0.7}
  });
  map.addLayer({
    id: 'position-dot',
    type: 'circle',
    source: 'position',
    filter: ['==', ['get', 'part'], 'position'],
    paint: {'circle-radius': 8, 'circle-color': positionColor, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3}
  });
}
