// Direction of travel for live buses. The provider reports only route and position, so direction
// is derived: from the feed's own movement bearing (the Go server tracks it), from movement between
// this page's checks, or, for a bus not seen moving yet, estimated from the nearest segment of its
// route in the bundled network snapshot. The estimate cannot tell the two directions of a street
// apart, so it is shown differently. Pure: no DOM, storage or network.
const RADIUS = 6371008.8, RAD = Math.PI / 180;
const local = (origin, point) => [(point[0] - origin[0]) * RAD * Math.cos(origin[1] * RAD) * RADIUS, (point[1] - origin[1]) * RAD * RADIUS];

export function metres(a, b) {
  const [x, y] = local(a, b);
  return Math.hypot(x, y);
}

// Compass bearing in degrees clockwise from north, 0 <= bearing < 360.
export function bearing(a, b) {
  const [x, y] = local(a, b);
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

// Route name -> stop-to-stop polylines, one per pattern, in travel order.
export function routeLines(network) {
  if (!network || typeof network.stops !== 'object' || !Array.isArray(network.patterns)) throw new Error('Invalid bus route network');
  const lines = new Map();
  for (const pattern of network.patterns) {
    const coordinates = (pattern.stops ?? []).map(id => network.stops[id]?.coordinates).filter(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite));
    if (typeof pattern.route !== 'string' || coordinates.length < 2) continue;
    if (!lines.has(pattern.route)) lines.set(pattern.route, []);
    lines.get(pattern.route).push(coordinates);
  }
  return lines;
}

// Bearing of the nearest route segment within maxDistance metres, or null.
export function routeBearing(lines, route, point, maxDistance = 2000) {
  const candidates = lines.get(route) ?? route.split('|').flatMap(part => lines.get(part.trim()) ?? []);
  let best = null;
  for (const line of candidates) for (let i = 0; i < line.length - 1; i++) {
    const a = local(point, line[i]), b = local(point, line[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / lengthSquared));
    const distance = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = {distance, bearing: bearing(line[i], line[i + 1])};
  }
  return best?.bearing ?? null;
}

// Follows buses across feed checks. Without vehicle IDs, buses are matched to the previous check by
// route and nearest plausible position. A bus keeps its last movement direction while it stands still.
export class DirectionTracker {
  constructor({minMove = 20, maxSpeed = 30, slack = 50, maxGap = 60000, maxRouteDistance = 2000} = {}) {
    Object.assign(this, {minMove, maxSpeed, slack, maxGap, maxRouteDistance});
    this.lines = new Map(); this.reset();
  }
  setNetwork(network) { this.lines = routeLines(network); }
  reset() { this.tracks = []; this.at = null; }
  update(features, at) {
    const elapsed = this.at === null ? Infinity : at - this.at;
    // After a pause, positions are too far apart in time to match reliably. A repeated (cached)
    // check has elapsed 0: positions match exactly and directions are kept.
    if (!(elapsed >= 0 && elapsed <= this.maxGap)) this.tracks = [];
    const reach = this.maxSpeed * Math.min(elapsed, this.maxGap) / 1000 + this.slack;
    const pairs = [];
    features.forEach((feature, index) => this.tracks.forEach((track, trackIndex) => {
      if (track.route !== feature.properties.route) return;
      const distance = metres(track.coordinates, feature.geometry.coordinates);
      if (distance <= reach) pairs.push({index, trackIndex, distance});
    }));
    pairs.sort((a, b) => a.distance - b.distance);
    const matched = new Map(), used = new Set();
    for (const pair of pairs) if (!matched.has(pair.index) && !used.has(pair.trackIndex)) {matched.set(pair.index, pair); used.add(pair.trackIndex);}
    const tracks = [];
    const output = features.map((feature, index) => {
      const {route} = feature.properties, coordinates = feature.geometry.coordinates;
      const pair = matched.get(index), previous = pair && this.tracks[pair.trackIndex];
      let direction = null, heading = 'unknown';
      // The server tracks movement across all viewers, so its direction is available immediately.
      if (feature.properties.heading === 'movement') {direction = feature.properties.bearing; heading = 'movement';}
      else if (previous && pair.distance >= this.minMove) {direction = bearing(previous.coordinates, coordinates); heading = 'movement';}
      else if (previous?.heading === 'movement') {direction = previous.bearing; heading = 'movement';}
      if (heading !== 'movement') {
        direction = routeBearing(this.lines, route, coordinates, this.maxRouteDistance);
        heading = direction === null ? 'unknown' : 'route';
      }
      // A stationary bus keeps its last known position as the reference for the next movement.
      tracks.push({route, coordinates: previous && pair.distance < this.minMove ? previous.coordinates : coordinates, bearing: direction, heading});
      return {...feature, properties: {...feature.properties, bearing: direction ?? 0, heading}};
    });
    this.tracks = tracks; this.at = at;
    return output;
  }
}
