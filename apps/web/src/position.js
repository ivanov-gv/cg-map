import {
  classifyFix,
  accuracyCircle,
  POSITION_FRESH_MILLISECONDS,
  POSITION_TIMEOUT_MILLISECONDS
} from './core.js';

// Current position for Discover (docs/ui-ux/user-stories/discover.md D-06). Coordinates stay in this object only: they are never
// stored, cached, logged or sent anywhere by the app. The browser/OS location provider may use its own services.
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
    const reevaluationIntervalMilliseconds = 5000;
    this.every(() => this.evaluate(), reevaluationIntervalMilliseconds);
    try {
      const status = await this.permissions?.query({name: 'geolocation'});
      if (status) {
        this.permission = status.state;
        status.addEventListener?.('change', () => {
          this.permission = status.state;
          if (status.state === 'denied') {
            this.stop();
            this.set('denied');
          } else if (status.state === 'granted' && this.watchId === null) this.watch();
        });
      }
    } catch (error) {
      console.warn('Permissions API unavailable; asking for location directly', error);
    }
    if (this.permission === 'denied') return this.set('denied');
    // Granted: no extra click. Prompt: the browser asks now; if it suppresses the prompt the visible action retries.
    this.watch();
  }
  watch() {
    this.stop();
    this.error = null;
    this.set(this.permission === 'prompt' ? 'prompt' : 'acquiring');
    this.watchId = this.geolocation.watchPosition(
      position => this.update(position),
      error => this.fail(error),
      {
        enableHighAccuracy: true,
        timeout: POSITION_TIMEOUT_MILLISECONDS,
        maximumAge: POSITION_FRESH_MILLISECONDS
      }
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
    if (![coords?.longitude, coords?.latitude, coords?.accuracy].every(Number.isFinite))
      return this.fail({code: 2, message: 'Invalid position'});
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
    if (error.code === 1) {
      this.stop();
      this.fix = null;
      // Mark a dismissed prompt so the UI can distinguish it from a pending one.
      if (this.permission !== 'denied') {
        this.error = 'dismissed';
      }
      return this.set(this.permission === 'denied' ? 'denied' : 'prompt');
    }
    // Keep a previous fix visible but let evaluate() mark it stale; without one, name the condition.
    this.error = error.code === 3 ? 'timeout' : 'unavailable';
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
  snapshot() {
    return {
      state: this.state,
      fix: this.fix ? {...this.fix, coordinates: [...this.fix.coordinates]} : null,
      age: this.fix ? this.now() - this.fix.timestamp : null,
      isPromptDismissed: this.state === 'prompt' && this.error === 'dismissed'
    };
  }
}

export function positionFeatures({state, fix}) {
  if (!fix || state === 'outside') return {type: 'FeatureCollection', features: []};
  const displayState = ['live', 'approximate', 'stale'].includes(state) ? state : 'stale';
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: accuracyCircle(fix.coordinates, fix.accuracy),
        properties: {part: 'accuracy', state: displayState}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [...fix.coordinates]},
        properties: {part: 'position', state: displayState}
      }
    ]
  };
}

export function installPositionLayers(map) {
  map.addSource('position', {type: 'geojson', data: positionFeatures({})});
  const stale = ['==', ['get', 'state'], 'stale'];
  map.addLayer({
    id: 'position-accuracy',
    type: 'fill',
    source: 'position',
    filter: ['==', ['get', 'part'], 'accuracy'],
    paint: {'fill-color': ['case', stale, '#7d8790', '#1f6fd1'], 'fill-opacity': 0.1}
  });
  map.addLayer({
    id: 'position-accuracy-edge',
    type: 'line',
    source: 'position',
    filter: ['==', ['get', 'part'], 'accuracy'],
    paint: {'line-color': ['case', stale, '#7d8790', '#1f6fd1'], 'line-width': 1.5, 'line-opacity': 0.7}
  });
  map.addLayer({
    id: 'position-dot',
    type: 'circle',
    source: 'position',
    filter: ['==', ['get', 'part'], 'position'],
    paint: {
      'circle-radius': 8,
      'circle-color': ['case', stale, '#7d8790', '#1f6fd1'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3
    }
  });
}
