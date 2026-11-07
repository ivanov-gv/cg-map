const requestIntervalMilliseconds = 1100;
const requestTimeoutMilliseconds = 20000;
const maximumCachedRoutes = 20;
const maximumRouteCoordinates = 100000;
const maximumRouteSteps = 150;

const validPoint = point =>
  Array.isArray(point) &&
  point.length === 2 &&
  point.every(Number.isFinite) &&
  Math.abs(point[0]) <= 180 &&
  Math.abs(point[1]) <= 90;
// Validate WGS84 endpoints before encoding the provider-specific profile and snapping radii.
export function roadURL(mode, from, to) {
  if (!['car', 'walk'].includes(mode) || !validPoint(from) || !validPoint(to))
    throw new Error('Invalid route request');
  const profile = mode === 'car' ? 'car' : 'foot';
  const coordinates = `${from.join(',')};${to.join(',')}`;
  const endpoint = `https://routing.openstreetmap.de/routed-${profile}/route/v1/driving/${coordinates}`;
  const snappingRadiiMetres = mode === 'car' ? '1000;1000' : '300;300';
  const query = `overview=full&geometries=geojson&steps=true&radiuses=${snappingRadiiMetres}`;
  return `${endpoint}?${query}`;
}
// Reject unusable provider geometry before it can reach the route renderer.
export function parseRoadRoute(value, mode) {
  const route = value?.routes?.[0];
  if (value?.code !== 'Ok' || !route)
    throw new Error(
      'No route found on this road or footpath network. Pick points closer to accessible streets.'
    );
  const hasValidMetrics =
    Number.isFinite(route.distance) &&
    route.distance >= 0 &&
    Number.isFinite(route.duration) &&
    route.duration >= 0;
  const hasValidGeometry =
    route.geometry?.type === 'LineString' &&
    Array.isArray(route.geometry.coordinates) &&
    route.geometry.coordinates.length >= 2 &&
    route.geometry.coordinates.length <= maximumRouteCoordinates &&
    route.geometry.coordinates.every(validPoint);
  if (!hasValidMetrics || !hasValidGeometry) throw new Error('Routing service returned an invalid route.');
  const steps = (route.legs ?? [])
    .flatMap(leg => leg.steps ?? [])
    .slice(0, maximumRouteSteps)
    .map(step => ({
      name: [
        step.maneuver?.type?.replaceAll('_', ' '),
        step.maneuver?.modifier,
        step.name ? `on ${step.name}` : ''
      ]
        .filter(Boolean)
        .join(' '),
      distance: step.distance
    }));
  return {
    mode,
    distance: route.distance,
    duration: route.duration,
    legs: [
      {
        kind: mode,
        coordinates: route.geometry.coordinates,
        distance: route.distance,
        duration: route.duration,
        approximate: false
      }
    ],
    steps
  };
}
// Serializes provider requests with a minimum interval and a bounded, in-memory result cache.
export class RoadRouter {
  constructor(fetchImpl = (...argumentsList) => fetch(...argumentsList)) {
    this.fetchImpl = fetchImpl;
    this.queue = Promise.resolve();
    this.lastRequestMilliseconds = 0;
    this.cache = new Map();
  }
  route(mode, from, to, signal) {
    const url = roadURL(mode, from, to);
    if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));
    const request = this.queue
      .catch(() => {
        // A failed request must not prevent later requests from using the queue.
      })
      .then(async () => {
        signal?.throwIfAborted();
        const waitMilliseconds = Math.max(
          0,
          requestIntervalMilliseconds - (Date.now() - this.lastRequestMilliseconds)
        );
        if (waitMilliseconds) await new Promise(resolve => setTimeout(resolve, waitMilliseconds));
        signal?.throwIfAborted();
        this.lastRequestMilliseconds = Date.now();
        const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
        const response = await this.fetchImpl(url, {
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          credentials: 'omit'
        });
        if (!response.ok) throw new Error('Routing service unavailable. Try again shortly.');
        const route = parseRoadRoute(await response.json(), mode);
        signal?.throwIfAborted();
        this.cache.set(url, route);
        if (this.cache.size > maximumCachedRoutes) this.cache.delete(this.cache.keys().next().value);
        return route;
      });
    this.queue = request;
    return request;
  }
}
