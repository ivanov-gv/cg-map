// Bus stops: on a road, on the side someone puts them, with the lines that stop there.
import {createElementWithText} from './dom.js';
import {roundedCoordinate} from './geometry-editing.js';
import {coordinateAtOffset, metricOffset, nearestPointOnLine} from './geometry-measures.js';
import {isDrivable} from './road-paths.js';
import {routeWithoutStop, servedStopIds} from './route-stops.js';

const stopsFile = 'transport-stops.geojson';
const routesFile = 'transit-routes.json';
const roadsFile = 'roads.geojson';
const farthestRoadMetres = 60;
// Beside the middle of the road, so that the side can be seen.
const roadsideMetres = 4;

function nearestRoad(coordinate, context) {
  let nearest = null;
  for (const {feature} of context.entriesOf(roadsFile)) {
    if (!isDrivable(feature)) continue;
    const candidate = nearestPointOnLine(coordinate, feature.geometry.coordinates);
    if (!nearest || candidate.distanceMetres < nearest.distanceMetres) nearest = {...candidate, feature};
  }
  return nearest && nearest.distanceMetres <= farthestRoadMetres ? nearest : null;
}

// Where a stop belongs: on the nearest road, on the side it was put, seen along the road's own direction.
export function roadsidePosition(coordinate, context) {
  const road = nearestRoad(coordinate, context);
  if (!road) return null;
  const {coordinates} = road.feature.geometry;
  const along = metricOffset(coordinates[road.segmentIndex + 1], coordinates[road.segmentIndex]);
  const toStop = metricOffset(coordinate, road.coordinate);
  const isLeft = along[0] * toStop[1] - along[1] * toStop[0] >= 0;
  const length = Math.hypot(...along);
  const leftward = [-along[1] / length, along[0] / length];
  const distance = isLeft ? roadsideMetres : -roadsideMetres;
  const position = coordinateAtOffset([leftward[0] * distance, leftward[1] * distance], road.coordinate);
  return {coordinate: roundedCoordinate(position), side: isLeft ? 'left' : 'right', roadName: road.feature.properties.name};
}

// A stop that nobody can place on a road has no side, and no bus passes there.
function stopProblem({feature, before}, context) {
  const isMoved = !before || JSON.stringify(before.geometry) !== JSON.stringify(feature.geometry);
  const isOnRoad = !isMoved || roadsidePosition(feature.geometry.coordinates, context) !== null;
  return isOnRoad ? null : 'A stop must be on a road that can be driven.';
}

// A new or moved stop knows its side of the road; one left where it was keeps what it says.
function stopOnItsSide(feature, context, {isNew, key}) {
  const before = context.session.workingFeature(stopsFile, key);
  const isMoved = isNew || JSON.stringify(before?.geometry) !== JSON.stringify(feature.geometry);
  const roadside = isMoved ? roadsidePosition(feature.geometry.coordinates, context) : null;
  return roadside ? {...feature, properties: {...feature.properties, side: roadside.side}} : feature;
}

function renderStopExtras(container, {feature, context}) {
  const {stopId, lines = []} = feature.properties;
  const isAddedHere = stopId.startsWith('local:');
  container.append(createElementWithText('p', isAddedHere ? 'Stop ID · none yet, added in the editor' : `Stop ID · ePG ${stopId}`));
  const heading = createElementWithText('h3', `Lines that stop here · ${lines.length}`);
  heading.className = 'section-title';
  container.append(heading);
  for (const entry of context.entriesOf(routesFile)) {
    const {number, name} = entry.feature.properties;
    if (!number || !lines.includes(number)) continue;
    container.append(createElementWithText('p', `Line ${number}${name ? ` · ${name}` : ''}`));
  }
  const note = createElementWithText('p', 'Which lines stop here is edited on Routes.');
  note.className = 'hint';
  container.append(note);
}

// A stop leaves the lines that serve it. A line that would be left with one stop keeps it, and so does the map.
function stopDeletion({feature}, context) {
  const {stopId} = feature.properties;
  const served = context.entriesOf(routesFile).filter(route => servedStopIds(route.feature).has(stopId));
  const routes = served.map(({filename, key, feature: route}) => ({filename, key, after: routeWithoutStop(route, stopId)}));
  const blocked = served.filter((_route, index) => routes[index].after === null);
  if (blocked.length > 0) {
    const names = blocked.map(({feature: route}) => route.properties.number ?? route.properties.name).join(', ');
    return {problem: `Line ${names} would have fewer than two stops. Change the line first.`};
  }
  const message = served.length > 0 ? `It is taken out of ${served.length} lines.` : '';
  return {message, edits: routes};
}

export const stopBehaviors = {
  [stopsFile]: {
    sections: () => [{title: 'Stop', fields: ['name', 'name:en', 'side']}],
    snappedPoint: (event, context) => roadsidePosition(event.lngLat.toArray(), context)?.coordinate ?? null,
    limitedGeometry: (geometry, _edit, context) => {
      const roadside = roadsidePosition(geometry.coordinates, context);
      return roadside ? {...geometry, coordinates: roadside.coordinate} : geometry;
    },
    prepared: stopOnItsSide,
    problem: stopProblem,
    renderExtras: renderStopExtras,
    deletion: stopDeletion
  }
};
