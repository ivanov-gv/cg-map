import {distanceKilometres} from './core.js';

// These are search heuristics, not a timetable or live departure predictions.
const walkingMetresPerKilometre = 1300;
const walkingMetresPerSecond = 1.3;
const maximumAccessWalkMetres = 1000;
const maximumTransferWalkMetres = 250;
const maximumAccessStops = 12;
const boardingPenaltySeconds = 300;
const maximumBoardings = 2;

// Straight links are deliberately marked approximate until the road router can replace them.
function walkingLeg(from, to, name) {
  const distanceMetres = distanceKilometres(from, to) * walkingMetresPerKilometre;
  return {
    kind: 'walk',
    coordinates: [from, to],
    distance: distanceMetres,
    duration: distanceMetres / walkingMetresPerSecond,
    name,
    approximate: true
  };
}

// Seed only the nearest reachable stops to keep the two boarding rounds bounded.
function accessLabels(stops, from) {
  const accessibleStops = stops
    .map(([stopId, stop]) => ({id: stopId, leg: walkingLeg(from, stop.coordinates, `Walk to ${stop.name}`)}))
    .filter(({leg}) => leg.distance <= maximumAccessWalkMetres)
    .sort((first, second) => first.leg.distance - second.leg.distance)
    .slice(0, maximumAccessStops);
  return new Map(accessibleStops.map(({id: stopId, leg}) => [stopId, {cost: leg.duration, legs: [leg]}]));
}

// The bus polyline joins recorded stops; it is not a road-snapped route shape.
function busLeg(network, pattern, boardingIndex, exitIndex, duration) {
  const stopIds = pattern.stops.slice(boardingIndex, exitIndex + 1);
  const coordinates = stopIds.map(stopId => network.stops[stopId].coordinates);
  const distanceMetres = coordinates.slice(1).reduce((total, point, index) => {
    return total + distanceKilometres(coordinates[index], point) * 1000;
  }, 0);
  return {
    kind: 'bus',
    route: pattern.route,
    name: `Bus ${pattern.route} toward ${pattern.headsign || pattern.name}`,
    from: network.stops[pattern.stops[boardingIndex]].name,
    to: network.stops[pattern.stops[exitIndex]].name,
    coordinates,
    duration,
    distance: distanceMetres,
    approximate: true
  };
}

// One boarding round retains the cheapest arrival at each stop, including the boarding penalty.
function ridePatterns(network, labels) {
  const arrivals = new Map();
  for (const pattern of network.patterns) {
    addPatternArrivals(network, pattern, labels, arrivals);
  }
  return arrivals;
}

// The immutable input labels keep one pattern scan from becoming an extra boarding round.
function addPatternArrivals(network, pattern, labels, arrivals) {
  for (let boardingIndex = 0; boardingIndex < pattern.stops.length - 1; boardingIndex++) {
    const beforeBoarding = labels.get(pattern.stops[boardingIndex]);
    if (!beforeBoarding) continue;
    for (let exitIndex = boardingIndex + 1; exitIndex < pattern.stops.length; exitIndex++) {
      const duration = pattern.offsets[exitIndex] - pattern.offsets[boardingIndex];
      if (duration <= 0) continue;
      const stopId = pattern.stops[exitIndex];
      const cost = beforeBoarding.cost + boardingPenaltySeconds + duration;
      if (arrivals.has(stopId) && arrivals.get(stopId).cost <= cost) continue;
      const leg = busLeg(network, pattern, boardingIndex, exitIndex, duration);
      arrivals.set(stopId, {cost, legs: [...beforeBoarding.legs, leg]});
    }
  }
}

// Keep the best previous result when the next round offers no cheaper exit walk.
function bestDestination(network, arrivals, to, best) {
  for (const [stopId, label] of arrivals) {
    const exit = walkingLeg(network.stops[stopId].coordinates, to, 'Walk to destination');
    if (exit.distance > maximumAccessWalkMetres) continue;
    const cost = label.cost + exit.duration;
    if (!best || cost < best.cost) best = {cost, legs: [...label.legs, exit]};
  }
  return best;
}

// Transfers start from bus arrivals only, so walking links cannot chain into an unbounded walk.
function transferLabels(network, stops, arrivals) {
  const labels = new Map(arrivals);
  for (const [stopId, label] of arrivals) {
    for (const [otherStopId, stop] of stops) {
      if (otherStopId === stopId) continue;
      const leg = walkingLeg(
        network.stops[stopId].coordinates,
        stop.coordinates,
        `Transfer on foot to ${stop.name}`
      );
      if (leg.distance > maximumTransferWalkMetres) continue;
      const cost = label.cost + leg.duration;
      if (!labels.has(otherStopId) || cost < labels.get(otherStopId).cost) {
        labels.set(otherStopId, {cost, legs: [...label.legs, leg]});
      }
    }
  }
  return labels;
}

// Two boarding rounds: direct buses or one transfer. Search penalties choose the result but are
// excluded from its displayed duration: timetables/live positions do not predict waiting time.
export function planTransit(network, from, to) {
  const stops = Object.entries(network.stops);
  let labels = accessLabels(stops, from);
  let best = null;
  for (let round = 0; round < maximumBoardings; round++) {
    const arrivals = ridePatterns(network, labels);
    best = bestDestination(network, arrivals, to, best);
    labels = round === 0 ? transferLabels(network, stops, arrivals) : new Map(arrivals);
  }
  if (!best) {
    throw new Error(
      'No bus suggestion found within a 1 km walk of these points. Try stops nearer the bus network.'
    );
  }
  return {
    mode: 'transit',
    legs: best.legs,
    duration: best.legs.reduce((total, leg) => total + leg.duration, 0),
    distance: best.legs.reduce((total, leg) => total + leg.distance, 0),
    retrievedAt: network.retrievedAt
  };
}
