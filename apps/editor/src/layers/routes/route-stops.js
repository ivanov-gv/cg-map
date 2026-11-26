// A route direction as an ordered list: stop IDs, positioned stops outside the stop file, and turn points that are no stops.
export const isTurnPoint = stop => typeof stop === 'object' && stop !== null && stop.turn !== undefined;
export const stopIdOf = stop => (typeof stop === 'string' ? stop : stop.id);

const stopsInside = direction =>
  [direction, ...(direction.variants ?? [])].flatMap(({stops}) => stops.filter(stop => !isTurnPoint(stop)).map(stopIdOf));

export function movedStop(stops, from, to) {
  const next = stops.toSpliced(from, 1);
  return next.toSpliced(to, 0, stops[from]);
}

// The other way: the same stops in reverse. Turn points belong to a street and a direction, so they are not copied.
export const reversedStops = stops => stops.filter(stop => !isTurnPoint(stop)).toReversed();

// Every stop ID a route serves.
export const servedStopIds = ({properties}) => new Set(properties.directions.flatMap(stopsInside));

// The lines that stop at each stop, from all numbered routes: {stopId: Set of numbers}.
export function linesByStop(routes) {
  const lines = new Map();
  for (const route of routes) {
    const {number} = route.properties;
    if (!number) continue;
    for (const stopId of servedStopIds(route)) {
      if (!lines.has(stopId)) lines.set(stopId, new Set());
      lines.get(stopId).add(number);
    }
  }
  return lines;
}

// Edits of the stops whose lines differ from what the routes say. Only stops one of these routes serves are looked at,
// so that other stops keep their reviewed lines.
export function lineEdits(stopEntries, routes, affectedRoutes) {
  const affectedIds = new Set(affectedRoutes.flatMap(route => [...servedStopIds(route)]));
  const lines = linesByStop(routes);
  return stopEntries.flatMap(({filename, key, feature}) => {
    const {stopId} = feature.properties;
    if (!affectedIds.has(stopId)) return [];
    const nextLines = [...(lines.get(stopId) ?? [])].sort();
    const currentLines = feature.properties.lines ?? [];
    if (JSON.stringify([...currentLines].sort()) === JSON.stringify(nextLines)) return [];
    const properties = {...feature.properties};
    if (nextLines.length > 0) properties.lines = nextLines;
    else delete properties.lines;
    return [{filename, key, after: {...feature, properties}}];
  });
}

// A route without a stop, or null when a direction would be left with fewer than two.
export function routeWithoutStop(route, stopId) {
  const keepOthers = stops => stops.filter(stop => isTurnPoint(stop) || stopIdOf(stop) !== stopId);
  const directions = route.properties.directions.map(direction => ({
    ...direction,
    stops: keepOthers(direction.stops),
    ...(direction.variants
      ? {variants: direction.variants.map(variant => ({...variant, stops: keepOthers(variant.stops)}))}
      : {})
  }));
  const sequences = directions.flatMap(direction => [direction, ...(direction.variants ?? [])]);
  const isServable = sequences.every(({stops}) => stops.filter(stop => !isTurnPoint(stop)).length >= 2);
  return isServable ? {...route, properties: {...route.properties, directions}} : null;
}
