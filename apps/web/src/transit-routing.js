// Bus suggestions from the bundled route snapshot: direct buses or one transfer, with bounded access and transfer
// walks. Timetables and live positions are deliberately not treated as departure predictions.
import {distanceKilometres} from './core.js';

// Straight-line distance times this factor approximates the walked distance along streets.
const walkingDetourFactor = 1.3;
const walkingMetresPerSecond = 1.3;
const metresPerKilometre = 1000;
const walkedMetresPerStraightKilometre = metresPerKilometre * walkingDetourFactor;
const maxAccessWalkMetres = 1000;
const maxTransferWalkMetres = 250;
const maxBoardingStops = 12;
// Added to every boarding, so a plan with fewer buses wins unless it is much slower. It is not a waiting time.
const boardingPenaltySeconds = 300;
// Round one boards directly; round two boards after one transfer.
const boardingRounds = 2;

function walkLeg(from, to, name) {
  const metres = distanceKilometres(from, to) * walkedMetresPerStraightKilometre;
  return {
    kind: 'walk',
    coordinates: [from, to],
    distance: metres,
    duration: metres / walkingMetresPerSecond,
    name,
    approximate: true
  };
}

const totalDuration = legs => legs.reduce((sum, leg) => sum + leg.duration, 0);
const totalDistance = legs => legs.reduce((sum, leg) => sum + leg.distance, 0);

function lineMetres(coordinates) {
  let metres = 0;
  for (let index = 1; index < coordinates.length; index++) {
    metres += distanceKilometres(coordinates[index - 1], coordinates[index]) * metresPerKilometre;
  }
  return metres;
}

// The nearest stops within walking distance of from, each reached by one walk leg.
function boardingLabels(stops, from) {
  const access = stops
    .map(([id, stop]) => ({id, leg: walkLeg(from, stop.coordinates, `Walk to ${stop.name}`)}))
    .filter(({leg}) => leg.distance <= maxAccessWalkMetres)
    .sort((first, second) => first.leg.distance - second.leg.distance)
    .slice(0, maxBoardingStops);
  return new Map(access.map(({id, leg}) => [id, {cost: leg.duration, legs: [leg]}]));
}

function busLeg(network, pattern, boardIndex, alightIndex) {
  const stopIds = pattern.stops.slice(boardIndex, alightIndex + 1);
  const coordinates = stopIds.map(stopId => network.stops[stopId].coordinates);
  return {
    kind: 'bus',
    route: pattern.route,
    name: `Bus ${pattern.route} toward ${pattern.headsign || pattern.name}`,
    from: network.stops[pattern.stops[boardIndex]].name,
    to: network.stops[pattern.stops[alightIndex]].name,
    coordinates,
    duration: pattern.offsets[alightIndex] - pattern.offsets[boardIndex],
    distance: lineMetres(coordinates),
    approximate: true
  };
}

// Every stop reachable by one more bus from a labelled stop, with its cheapest plan: stop id -> {cost, legs}.
function rideOneBus(network, labels) {
  const ridden = new Map();
  for (const pattern of network.patterns) {
    for (let boardIndex = 0; boardIndex < pattern.stops.length - 1; boardIndex++) {
      const boarding = labels.get(pattern.stops[boardIndex]);
      if (!boarding) continue;
      for (let alightIndex = boardIndex + 1; alightIndex < pattern.stops.length; alightIndex++) {
        const rideSeconds = pattern.offsets[alightIndex] - pattern.offsets[boardIndex];
        if (rideSeconds <= 0) continue;
        const stopId = pattern.stops[alightIndex];
        const cost = boarding.cost + boardingPenaltySeconds + rideSeconds;
        const isCheaper = !ridden.has(stopId) || ridden.get(stopId).cost > cost;
        if (!isCheaper) continue;
        const leg = busLeg(network, pattern, boardIndex, alightIndex);
        ridden.set(stopId, {cost, legs: [...boarding.legs, leg]});
      }
    }
  }
  return ridden;
}

// The cheapest complete plan from ridden stops to the destination, or best when none is cheaper.
function bestArrival(network, ridden, to, best) {
  for (const [stopId, label] of ridden) {
    const exit = walkLeg(network.stops[stopId].coordinates, to, 'Walk to destination');
    if (exit.distance > maxAccessWalkMetres) continue;
    const cost = label.cost + exit.duration;
    if (!best || cost < best.cost) best = {cost, legs: [...label.legs, exit]};
  }
  return best;
}

// Ridden stops plus every stop a short walk from one, as boarding points for the next bus.
function withTransferWalks(network, stops, ridden) {
  const labels = new Map(ridden);
  for (const [stopId, label] of ridden) {
    for (const [otherId, otherStop] of stops) {
      if (otherId === stopId) continue;
      const transfer = walkLeg(
        network.stops[stopId].coordinates,
        otherStop.coordinates,
        `Transfer on foot to ${otherStop.name}`
      );
      if (transfer.distance > maxTransferWalkMetres) continue;
      const cost = label.cost + transfer.duration;
      const isCheaper = !labels.has(otherId) || cost < labels.get(otherId).cost;
      if (isCheaper) labels.set(otherId, {cost, legs: [...label.legs, transfer]});
    }
  }
  return labels;
}

// Returns {mode: 'transit', legs, duration, distance, retrievedAt}, in seconds and metres, or throws when no stop
// pair within walking distance connects from and to.
export function planTransit(network, from, to) {
  const stops = Object.entries(network.stops);
  let labels = boardingLabels(stops, from);
  let best = null;
  for (let round = 0; round < boardingRounds; round++) {
    const ridden = rideOneBus(network, labels);
    best = bestArrival(network, ridden, to, best);
    const isLastRound = round === boardingRounds - 1;
    labels = isLastRound ? new Map(ridden) : withTransferWalks(network, stops, ridden);
  }
  if (!best) {
    throw new Error('No bus suggestion found within a 1 km walk of these points. Try stops nearer the bus network.');
  }
  return {
    mode: 'transit',
    legs: best.legs,
    duration: totalDuration(best.legs),
    distance: totalDistance(best.legs),
    retrievedAt: network.retrievedAt
  };
}
