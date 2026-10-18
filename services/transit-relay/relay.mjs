export const UPSTREAM = 'https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public';
export const SOURCE = 'https://epodgorica.me/javniprevoz/mapa';
const TTL = 13000;
const MAX_STALE = 60000;

export function normalizeVehicles(rows) {
  if (!Array.isArray(rows) || rows.length > 2000) throw new Error('Invalid upstream vehicle feed');
  const seen = new Set();
  const features = [];
  for (const row of rows) {
    if (!row || typeof row.routeName !== 'string') continue;
    const longitude = row.longitude, latitude = row.latitude, route = row.routeName.trim().slice(0, 32);
    if (!route || !Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < 17.8 || longitude > 21 || latitude < 41.3 || latitude > 44.1) continue;
    const key = `${route}:${longitude}:${latitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({type: 'Feature', geometry: {type: 'Point', coordinates: [longitude, latitude]}, properties: {route}});
  }
  if (rows.length && !features.length) throw new Error('Upstream returned no valid vehicle positions');
  return features;
}

export function createRelay({fetchImpl = fetch, now = Date.now} = {}) {
  let cached = null, pending = null;
  async function refresh() {
    const response = await fetchImpl(UPSTREAM, {headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('Vehicle provider unavailable');
    const text = await response.text();
    if (text.length > 512000) throw new Error('Vehicle feed is too large');
    const features = normalizeVehicles(JSON.parse(text));
    cached = {type: 'FeatureCollection', features, fetchedAt: new Date(now()).toISOString(), source: SOURCE, stale: false};
    return cached;
  }
  return async function handle(request) {
    const headers = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=5, s-maxage=10', 'X-Content-Type-Options': 'nosniff'};
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers});
    if (request.method !== 'GET') return Response.json({error: 'Method not allowed'}, {status: 405, headers: {...headers, Allow: 'GET, OPTIONS'}});
    const age = cached ? now() - Date.parse(cached.fetchedAt) : Infinity;
    if (age < TTL) return Response.json(cached, {headers});
    try {
      if (!pending) pending = refresh().finally(() => {pending = null;});
      return Response.json(await pending, {headers});
    } catch {
      if (cached && now() - Date.parse(cached.fetchedAt) <= MAX_STALE) return Response.json({...cached, stale: true}, {headers: {...headers, 'Cache-Control': 'no-store'}});
      return Response.json({type: 'FeatureCollection', features: [], fetchedAt: null, source: SOURCE, stale: true, error: 'Live bus positions are temporarily unavailable'}, {status: 503, headers: {...headers, 'Cache-Control': 'no-store'}});
    }
  };
}
