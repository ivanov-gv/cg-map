// Car and walking routes from the public FOSSGIS OSRM service. Responses are validated, cached for the session only,
// and never stored offline.
const maxRouteCoordinates = 100000;
const maxSteps = 150;
// The public service asks for at most about one request per second.
const minRequestSpacingMilliseconds = 1100;
const requestTimeoutMilliseconds = 20000;
const maxCachedRoutes = 20;
// How far, in metres, OSRM may snap each endpoint to its road or path network.
const snapRadiusMetres = {car: 1000, walk: 300};

const isValidPoint = point =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every(Number.isFinite) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90;

// mode is 'car' or 'walk'; anything else, or an invalid point, throws.
export function roadURL(mode, from, to) {
  const isValidRequest = ['car', 'walk'].includes(mode) && isValidPoint(from) && isValidPoint(to);
  if (!isValidRequest) throw new Error('Invalid route request');
  const profile = mode === 'car' ? 'car' : 'foot';
  const radius = snapRadiusMetres[mode];
  const query = `overview=full&geometries=geojson&steps=true&radiuses=${radius};${radius}`;
  return `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${from.join(',')};${to.join(',')}?${query}`;
}

function isValidRoute(route) {
  const coordinates = route.geometry?.coordinates;
  const hasValidMeasures =
    Number.isFinite(route.distance) && route.distance >= 0 && Number.isFinite(route.duration) && route.duration >= 0;
  const hasValidLine =
    route.geometry?.type === 'LineString' &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    coordinates.length <= maxRouteCoordinates &&
    coordinates.every(isValidPoint);
  return hasValidMeasures && hasValidLine;
}

// "turn left on Njegoševa": the manoeuvre, its direction and the street, as far as OSRM names them.
function stepName(step) {
  const maneuver = step.maneuver?.type?.replaceAll('_', ' ');
  const street = step.name ? `on ${step.name}` : '';
  return [maneuver, step.maneuver?.modifier, street].filter(Boolean).join(' ');
}

// Returns {mode, distance, duration, legs, steps} in metres and seconds, the shape transit plans share, or throws.
export function parseRoadRoute(value, mode) {
  const route = value?.routes?.[0];
  if (value?.code !== 'Ok' || !route) {
    throw new Error('No route found on this road or footpath network. Pick points closer to accessible streets.');
  }
  if (!isValidRoute(route)) throw new Error('Routing service returned an invalid route.');
  const steps = (route.legs ?? [])
    .flatMap(leg => leg.steps ?? [])
    .slice(0, maxSteps)
    .map(step => ({name: stepName(step), distance: step.distance}));
  const leg = {
    kind: mode,
    coordinates: route.geometry.coordinates,
    distance: route.distance,
    duration: route.duration,
    approximate: false
  };
  return {mode, distance: route.distance, duration: route.duration, legs: [leg], steps};
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

// Sends one request at a time, spaced for the public service, and remembers recent answers.
export class RoadRouter {
  constructor(fetchImpl = (...args) => fetch(...args)) {
    this.fetchImpl = fetchImpl;
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
    this.cache = new Map();
  }

  // A cancelled signal rejects the request before or after it is sent; a cancelled answer is never cached.
  route(mode, from, to, signal) {
    const url = roadURL(mode, from, to);
    if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
    // A failed request must not stop the ones queued after it.
    const run = this.queue.catch(() => {}).then(() => this.#request(url, mode, signal));
    this.queue = run;
    return run;
  }

  async #request(url, mode, signal) {
    signal?.throwIfAborted();
    const remainingSpacing = Math.max(0, minRequestSpacingMilliseconds - (Date.now() - this.lastRequestAt));
    if (remainingSpacing) await wait(remainingSpacing);
    signal?.throwIfAborted();
    this.lastRequestAt = Date.now();
    const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetchImpl(url, {signal: requestSignal, credentials: 'omit'});
    if (!response.ok) throw new Error('Routing service unavailable. Try again shortly.');
    const route = parseRoadRoute(await response.json(), mode);
    signal?.throwIfAborted();
    this.#remember(url, route);
    return route;
  }

  // Keeps the newest answers; the oldest goes first.
  #remember(url, route) {
    this.cache.set(url, route);
    if (this.cache.size > maxCachedRoutes) this.cache.delete(this.cache.keys().next().value);
  }
}
