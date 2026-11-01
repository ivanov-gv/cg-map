// Where map layers and live vehicles come from.
// server: the Kompas Go server's APIs (services/backend), which serves config.json {"api":"server"}.
// mock: the current static data, for hosts without the server (GitHub Pages, make dev): the release
//       archive read directly and the hosted transit relay. The artifact ships config.json {"api":"mock"}.
// A ?api=server or ?api=mock query parameter overrides the host's choice.
export const RELAY_URL = 'https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles';
export const DATA_MODES = ['server', 'mock'];

export function resolveDataMode(search, config) {
  const requested = new URLSearchParams(search).get('api');
  if (requested !== null) {
    if (!DATA_MODES.includes(requested)) throw new Error(`Unknown data mode ?api=${requested}. Use ?api=server or ?api=mock.`);
    return requested;
  }
  // No config means a static host without one, or offline startup: use the bundled data.
  if (config === null) return 'mock';
  if (!DATA_MODES.includes(config?.api)) throw new Error('Invalid config.json: "api" must be "server" or "mock".');
  return config.api;
}

// base is the app's own URL; server API paths are relative so the app also works under a path prefix.
export function dataEndpoints(mode, base) {
  if (mode === 'server') return {layers: new URL('api/v1/layers', base).href, vehicles: new URL('api/v1/transport/vehicles', base).href};
  return {layers: null, vehicles: RELAY_URL};
}

// MapLibre source URL for the basemap. A verified offline download always wins, so offline use
// never depends on the server.
export function basemapURL(endpoints, archiveURL, offline) {
  return endpoints.layers && !offline ? endpoints.layers : 'pmtiles://' + archiveURL;
}
