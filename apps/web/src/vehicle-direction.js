// Direction of travel for live vehicles. The provider reports only route and position, so direction
// is derived: from the feed's own movement bearing (the Go server tracks it), from movement between
// this page's checks, or, for a vehicle not seen moving yet, estimated from the nearest segment of its
// route in the bundled network snapshot. The estimate cannot tell the two directions of a route segment
// apart, so it is shown differently. Pure: no DOM, storage or network.
//
// Movement tracking mirrors services/backend/internal/service/vehicles/direction.go, with the same names.
// Coordinates are [longitude, latitude].

// metres a vehicle must move before its direction changes; smaller moves may be GPS noise
const minimumMovementMetres = 20;
// limits how far one vehicle can plausibly travel between checks
const maximumSpeedMetresPerSecond = 30;
// added to the distance a vehicle can plausibly travel between checks
const matchToleranceMetres = 50;
// the longest pause between checks that still allows matching vehicles
const maximumTrackingGapMilliseconds = 60000;
const millisecondsPerSecond = 1000;
// how far from a route a vehicle may be and still take its direction from that route
const maximumRouteDistanceMetres = 2000;

const degreesPerCircle = 360;
const earthRadiusMetres = 6371008.8;
const radiansPerDegree = Math.PI / 180;

const headingMovement = 'movement';
const headingRoute = 'route';
const headingUnknown = 'unknown';

// How far point lies east and north of origin, on a flat plane (equirectangular; fine at city scale).
function offsetMetres(origin, point) {
  const east =
    (point[0] - origin[0]) * radiansPerDegree * Math.cos(origin[1] * radiansPerDegree) * earthRadiusMetres;
  const north = (point[1] - origin[1]) * radiansPerDegree * earthRadiusMetres;
  return [east, north];
}

// The distance between two positions.
export function distanceMetres(from, to) {
  const [east, north] = offsetMetres(from, to);
  return Math.hypot(east, north);
}

// The direction from one position to another in degrees clockwise from north, 0 <= direction < 360.
export function compassDirection(from, to) {
  const [east, north] = offsetMetres(from, to);
  return (Math.atan2(east, north) / radiansPerDegree + degreesPerCircle) % degreesPerCircle;
}

function isCoordinatePair(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
}

// Route name -> stop-to-stop polylines, one per pattern, in travel order.
export function routeLines(network) {
  if (!network || typeof network.stops !== 'object' || !Array.isArray(network.patterns)) {
    throw new Error('Invalid route network');
  }
  const linesByRoute = new Map();
  for (const pattern of network.patterns) {
    const stopIds = pattern.stops ?? [];
    const line = stopIds.map((stopId) => network.stops[stopId]?.coordinates).filter(isCoordinatePair);
    if (typeof pattern.route !== 'string' || line.length < 2) {
      continue;
    }
    if (!linesByRoute.has(pattern.route)) {
      linesByRoute.set(pattern.route, []);
    }
    linesByRoute.get(pattern.route).push(line);
  }
  return linesByRoute;
}

// Metres from point to the segment start-end, or null for a zero-length segment.
function segmentDistanceMetres(point, start, end) {
  const [startEast, startNorth] = offsetMetres(point, start);
  const [endEast, endNorth] = offsetMetres(point, end);
  const segmentEast = endEast - startEast;
  const segmentNorth = endNorth - startNorth;
  const lengthSquared = segmentEast * segmentEast + segmentNorth * segmentNorth;
  if (!lengthSquared) {
    return null;
  }
  // the closest point on the segment, as a fraction of its length; point is the origin here
  const projection = -(startEast * segmentEast + startNorth * segmentNorth) / lengthSquared;
  const fractionAlongSegment = Math.max(0, Math.min(1, projection));
  return Math.hypot(
    startEast + fractionAlongSegment * segmentEast,
    startNorth + fractionAlongSegment * segmentNorth
  );
}

// Direction of the nearest route segment within maximumRouteDistanceMetres, or null. A combined route name
// such as "7|99" falls back to its parts.
export function routeDirection(linesByRoute, route, point) {
  const candidateLines =
    linesByRoute.get(route) ?? route.split('|').flatMap((part) => linesByRoute.get(part.trim()) ?? []);
  let nearestMetres = Infinity;
  let nearestDirection = null;
  for (const line of candidateLines) {
    for (let index = 0; index < line.length - 1; index++) {
      const segmentMetres = segmentDistanceMetres(point, line[index], line[index + 1]);
      const isNearer =
        segmentMetres !== null &&
        segmentMetres <= maximumRouteDistanceMetres &&
        segmentMetres < nearestMetres;
      if (isNearer) {
        nearestMetres = segmentMetres;
        nearestDirection = compassDirection(line[index], line[index + 1]);
      }
    }
  }
  return nearestDirection;
}

// Returns {direction} from this vehicle's movement, or null without movement. The wrapper is needed
// because the server's direction may itself be missing. The server's direction wins, because it
// tracks movement across all viewers; a vehicle that barely moved keeps its last direction.
function knownMovementDirection(vehicle, previousVehicle, match) {
  if (vehicle.properties.heading === headingMovement) {
    return {direction: vehicle.properties.bearing};
  }
  if (previousVehicle && match.separationMetres >= minimumMovementMetres) {
    return {direction: compassDirection(previousVehicle.movementAnchor, vehicle.geometry.coordinates)};
  }
  if (previousVehicle?.heading === headingMovement) {
    return {direction: previousVehicle.direction};
  }
  return null;
}

// Follows vehicles across feed checks. Without vehicle IDs, a vehicle is assumed to be the nearest
// plausible previous vehicle on its route. A vehicle keeps its last movement direction while it stands still.
export class DirectionTracker {
  constructor() {
    this.linesByRoute = new Map();
    this.reset();
  }

  // Throws on an invalid network.
  setNetwork(network) {
    this.linesByRoute = routeLines(network);
  }

  reset() {
    this.previouslyTracked = [];
    this.previousFetchedAt = null;
  }

  // Returns vehicles with bearing and heading set, and remembers this check. fetchedAt is in milliseconds.
  update(vehicles, fetchedAt) {
    const elapsedMilliseconds =
      this.previousFetchedAt === null ? Infinity : fetchedAt - this.previousFetchedAt;
    // After a pause, positions are too far apart in time to match reliably. A repeated (cached)
    // check has elapsed 0: positions match exactly and directions are kept.
    if (!(elapsedMilliseconds >= 0 && elapsedMilliseconds <= maximumTrackingGapMilliseconds)) {
      this.previouslyTracked = [];
    }
    const elapsedSeconds =
      Math.min(elapsedMilliseconds, maximumTrackingGapMilliseconds) / millisecondsPerSecond;
    const maximumMatchDistanceMetres = maximumSpeedMetresPerSecond * elapsedSeconds + matchToleranceMetres;
    const matches = this.matchToPreviouslyTracked(vehicles, maximumMatchDistanceMetres);

    const currentlyTracked = [];
    const publishedVehicles = vehicles.map((vehicle, vehicleIndex) => {
      const match = matches.get(vehicleIndex);
      const previousVehicle = match && this.previouslyTracked[match.previousIndex];
      const tracked = this.nextTrackedVehicle(vehicle, previousVehicle, match);
      currentlyTracked.push(tracked);
      return {
        ...vehicle,
        properties: {...vehicle.properties, bearing: tracked.direction ?? 0, heading: tracked.heading}
      };
    });

    this.previouslyTracked = currentlyTracked;
    this.previousFetchedAt = fetchedAt;
    return publishedVehicles;
  }

  // Pairs each vehicle with at most one previous vehicle, keyed by vehicle index. Each side is used at
  // most once, and the closest available pair wins.
  matchToPreviouslyTracked(vehicles, maximumDistanceMetres) {
    const candidates = [];
    vehicles.forEach((vehicle, vehicleIndex) => {
      this.previouslyTracked.forEach((previousVehicle, previousIndex) => {
        if (previousVehicle.route !== vehicle.properties.route) {
          return;
        }
        const separationMetres = distanceMetres(previousVehicle.movementAnchor, vehicle.geometry.coordinates);
        if (separationMetres <= maximumDistanceMetres) {
          candidates.push({vehicleIndex, previousIndex, separationMetres});
        }
      });
    });
    candidates.sort((left, right) => left.separationMetres - right.separationMetres);

    const matches = new Map();
    const usedPrevious = new Set();
    for (const candidate of candidates) {
      if (matches.has(candidate.vehicleIndex) || usedPrevious.has(candidate.previousIndex)) {
        continue;
      }
      matches.set(candidate.vehicleIndex, candidate);
      usedPrevious.add(candidate.previousIndex);
    }
    return matches;
  }

  // The state to remember for this vehicle. A vehicle that barely moved keeps its anchor, so small steps add up.
  nextTrackedVehicle(vehicle, previousVehicle, match) {
    const {route} = vehicle.properties;
    const position = vehicle.geometry.coordinates;
    const hasBarelyMoved = previousVehicle && match.separationMetres < minimumMovementMetres;
    const movementAnchor = hasBarelyMoved ? previousVehicle.movementAnchor : position;

    const movement = knownMovementDirection(vehicle, previousVehicle, match);
    if (movement) {
      return {route, movementAnchor, direction: movement.direction, heading: headingMovement};
    }
    const direction = routeDirection(this.linesByRoute, route, position);
    return {route, movementAnchor, direction, heading: direction === null ? headingUnknown : headingRoute};
  }
}
