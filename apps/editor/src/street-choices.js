// Streets someone can pick for an address: only those that exist on the Roads layer, nearest first.
import {distanceMetres, nearestPointOnLine} from './geometry-measures.js';

const foldedName = name => name.trim().toLowerCase();

// Far roads only need a rough distance, so the exact one is computed for roads that can still win.
function roughDistanceMetres(road, coordinate) {
  return Math.min(...road.geometry.coordinates.map(point => distanceMetres(point, coordinate)));
}

// [{name, distanceMetres}] of every named road, one entry per name, nearest first.
export function streetsNear(roads, coordinate) {
  const nearestByName = new Map();
  for (const {feature} of roads) {
    const {name} = feature.properties;
    if (!name?.trim()) continue;
    const rough = roughDistanceMetres(feature, coordinate);
    const known = nearestByName.get(name);
    if (known && known.rough <= rough) continue;
    nearestByName.set(name, {rough, feature});
  }
  const streets = [...nearestByName].map(([name, {feature}]) => ({
    name,
    distanceMetres: nearestPointOnLine(coordinate, feature.geometry.coordinates).distanceMetres
  }));
  return streets.sort((first, second) => first.distanceMetres - second.distanceMetres);
}

export const matchingStreets = (streets, search) =>
  streets.filter(({name}) => foldedName(name).includes(foldedName(search)));
