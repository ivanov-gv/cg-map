export const TRANSPORT_URL = 'https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles';
export const TRANSPORT_INTERVAL = 13000;
const MAX_AGE = 60000;
const empty = () => ({type: 'FeatureCollection', features: []});

export function validTransportFeed(value, now = Date.now()) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features) || value.features.length > 2000) throw new Error('Invalid transport response');
  const checked = Date.parse(value.fetchedAt);
  if (!Number.isFinite(checked) || checked > now + 30000 || now - checked > MAX_AGE) throw new Error('Transport feed has expired');
  for (const feature of value.features) {
    const point = feature?.geometry?.coordinates;
    if (feature?.type !== 'Feature' || feature.geometry?.type !== 'Point' || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || point[0] < 17.8 || point[0] > 21 || point[1] < 41.3 || point[1] > 44.1 || typeof feature.properties?.route !== 'string' || feature.properties.route.length > 32) throw new Error('Invalid bus position');
  }
  return value;
}

export function installTransport(map) {
  map.addSource('transport-stops', {type: 'geojson', data: 'data/transport-stops.geojson'});
  map.addLayer({id: 'transport-stops', type: 'circle', source: 'transport-stops', minzoom: 13, layout: {visibility: 'none'}, paint: {'circle-color': '#ffffff', 'circle-radius': 5, 'circle-stroke-color': '#195c9e', 'circle-stroke-width': 2}});
  map.addLayer({id: 'transport-stop-names', type: 'symbol', source: 'transport-stops', minzoom: 16, layout: {visibility: 'none', 'text-field': ['get', 'name'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-anchor': 'top', 'text-offset': [0, 0.8], 'text-max-width': 14}, paint: {'text-color': '#195c9e', 'text-halo-color': '#ffffff', 'text-halo-width': 2}});
  map.addSource('transport', {type: 'geojson', data: empty()});
  map.addLayer({id: 'transport-buses', type: 'circle', source: 'transport', layout: {visibility: 'none'}, paint: {'circle-color': '#195c9e', 'circle-radius': 13, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2}});
  map.addLayer({id: 'transport-routes', type: 'symbol', source: 'transport', layout: {visibility: 'none', 'text-field': ['get', 'route'], 'text-font': ['Open Sans Semibold'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true}, paint: {'text-color': '#ffffff'}});
}

export class TransportFeed {
  constructor(map, {fetchImpl = (...args) => fetch(...args), onStatus = () => {}, now = Date.now, schedule = (...args) => setTimeout(...args), cancel = timer => clearTimeout(timer)} = {}) {
    Object.assign(this, {map, fetchImpl, onStatus, now, schedule, cancel});
    this.enabled = false; this.generation = 0; this.snapshot = null;
  }
  clearTimer() { if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; }
  visible(value) {
    for (const id of ['transport-stops', 'transport-stop-names', 'transport-buses', 'transport-routes']) this.map.setLayoutProperty(id, 'visibility', value ? 'visible' : 'none');
  }
  setEnabled(enabled) {
    this.enabled = enabled; this.generation++; this.clearTimer(); this.controller?.abort();
    this.snapshot = null; this.map.getSource('transport').setData(empty()); this.visible(enabled);
    this.onStatus({state: enabled ? 'loading' : 'off', count: 0});
    if (enabled) return this.refresh();
  }
  pause(reason = 'offline') {
    this.generation++; this.clearTimer(); this.controller?.abort();
    this.snapshot = null; this.map.getSource('transport').setData(empty());
    if (this.enabled) this.onStatus({state: reason, count: 0});
  }
  async refresh() {
    if (!this.enabled) return;
    this.clearTimer(); this.controller?.abort();
    const generation = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    const timeout = this.schedule(() => controller.abort(), 10000);
    try {
      const response = await this.fetchImpl(TRANSPORT_URL, {signal: this.controller.signal, credentials: 'omit', cache: 'no-store'});
      if (!response.ok) throw new Error('Bus feed unavailable');
      const data = validTransportFeed(await response.json(), this.now());
      if (!this.enabled || generation !== this.generation) return;
      this.snapshot = data;
      this.map.getSource('transport').setData({type: 'FeatureCollection', features: data.features});
      this.onStatus({state: data.stale ? 'stale' : 'live', count: data.features.length, fetchedAt: data.fetchedAt});
    } catch {
      if (!this.enabled || generation !== this.generation) return;
      const stillUsable = this.snapshot && this.now() - Date.parse(this.snapshot.fetchedAt) <= MAX_AGE;
      if (!stillUsable) {this.snapshot = null; this.map.getSource('transport').setData(empty());}
      this.onStatus({state: stillUsable ? 'stale' : 'unavailable', count: this.snapshot?.features.length ?? 0, fetchedAt: this.snapshot?.fetchedAt});
    } finally {
      this.cancel(timeout);
      if (this.enabled && generation === this.generation) this.timer = this.schedule(() => this.refresh(), TRANSPORT_INTERVAL);
    }
  }
}
