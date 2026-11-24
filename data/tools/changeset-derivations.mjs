// Facts the pipeline computes from the sources, brought back in step after an editor changeset: joins between files,
// measures of a changed shape and the direction of a contour. Everything here follows from reviewed objects; nothing
// is an editorial choice, so a changeset never carries it.
import {entranceBearing} from './building-entrances.mjs';
import {reversedClosedContours} from './relief-directions.mjs';
import {requireThat} from './changeset-rules.mjs';

const buildingsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';
const roadsFile = 'roads.geojson';
const summitsFile = 'summits.geojson';
const contoursFile = 'contours.geojson';
// The relief contract reports a summit whose mapped height is further than this from the terrain model.
const summitMismatchMetres = 25;
const metresPerDegreeLatitude = 111320;

// One object in a file: its entity ID, and its part when the pipeline split it.
export const entityKey = ({entityId, entityPart}) => `${entityId}#${entityPart ?? ''}`;

export const isLocalId = value => typeof value === 'string' && value.startsWith('local:');

function indexByEntityKey(features) {
  return new Map(features.map((feature, index) => [entityKey(feature.properties), index]));
}

// An added label states its building; its stored join is the building's position, as for every other label.
function adoptedLabel(label, buildingIndexById) {
  const {buildingEntityId, ...properties} = label.properties;
  if (buildingEntityId === undefined) return label;
  const footprintIndex = buildingIndexById.get(buildingEntityId);
  requireThat(footprintIndex !== undefined, `${labelsFile}: no building ${buildingEntityId}`);
  const identity = properties.entityId;
  return {
    ...label,
    id: identity,
    properties: {...properties, osm_id: identity, address_sources: [identity], footprintIndex}
  };
}

// A building's position changes when others are added or deleted, so every label follows its building by identity.
export function labelsFollowingBuildings(labels, previousBuildings, buildings) {
  const indexByKey = indexByEntityKey(buildings.features);
  const buildingIndexById = new Map();
  buildings.features.forEach(({properties}, index) => {
    if (!buildingIndexById.has(properties.entityId)) buildingIndexById.set(properties.entityId, index);
  });
  const features = labels.features.map(label => {
    const {footprintIndex} = label.properties;
    if (footprintIndex === undefined) return adoptedLabel(label, buildingIndexById);
    const building = previousBuildings.features[footprintIndex];
    const nextIndex = building ? indexByKey.get(entityKey(building.properties)) : undefined;
    const number = label.properties['addr:housenumber'];
    requireThat(nextIndex !== undefined, `${labelsFile}: label ${number} belongs to a deleted building`);
    if (nextIndex === footprintIndex) return label;
    return {...label, properties: {...label.properties, footprintIndex: nextIndex}};
  });
  return {...labels, features};
}

// A located entrance points into its building, so it turns when the walls around it change. Labels of untouched
// buildings keep their reviewed bearings.
export function labelsWithBearings(labels, previousLabels, buildings, changedBuildingKeys) {
  const previousById = new Map(previousLabels.features.map(label => [label.id, label]));
  const features = labels.features.map(label => {
    const {entrances, footprintIndex} = label.properties;
    const building = buildings.features[footprintIndex];
    if (!entrances || !building) return label;
    const previousEntrances = previousById.get(label.id)?.properties.entrances;
    const isMoved = JSON.stringify(previousEntrances) !== JSON.stringify(entrances);
    if (!isMoved && !changedBuildingKeys.has(entityKey(building.properties))) return label;
    const turned = entrances.map(entrance => ({
      ...entrance,
      bearing: entranceBearing(entrance.coordinates, building.geometry)
    }));
    return {...label, properties: {...label.properties, entrances: turned}};
  });
  return {...labels, features};
}

// Matches the extractor's case- and whitespace-only street fold.
const normalizedStreet = value => value.trim().split(/\s+/u).join(' ').toLowerCase();

function roadsByStreet(roads) {
  const groups = new Map();
  for (const road of roads.features) {
    const {name} = road.properties;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    const street = normalizedStreet(name);
    if (!groups.has(street)) groups.set(street, []);
    groups.get(street).push(road);
  }
  return groups;
}

// Same-named roads are one street when every one can be reached from the first through shared ends.
function areConnected(roads) {
  const endsOf = road => [road.geometry.coordinates[0], road.geometry.coordinates.at(-1)].map(String);
  const reachedEnds = new Set(endsOf(roads[0]));
  let waiting = roads.slice(1);
  let hasProgress = true;
  while (waiting.length > 0 && hasProgress) {
    const reachable = waiting.filter(road => endsOf(road).some(end => reachedEnds.has(end)));
    for (const road of reachable) endsOf(road).forEach(end => reachedEnds.add(end));
    waiting = waiting.filter(road => !reachable.includes(road));
    hasProgress = reachable.length > 0;
  }
  return waiting.length === 0;
}

const numberOfWay = entityId => Number.parseInt(entityId.split('/')[1], 10);

// Ways in number order as the extractor writes them, then roads added by the editor.
export function compareRoadIds(first, second) {
  const isFirstLocal = isLocalId(first);
  const isSecondLocal = isLocalId(second);
  if (isFirstLocal !== isSecondLocal) return isFirstLocal ? 1 : -1;
  if (isFirstLocal) return first < second ? -1 : 1;
  return numberOfWay(first) - numberOfWay(second);
}

function streetJoin(roads) {
  if (!roads || !areConnected(roads)) return null;
  const entityIds = [...new Set(roads.map(road => road.properties.entityId))].sort(compareRoadIds);
  return {'addr:streetEntityId': entityIds[0], 'addr:streetEntityIds': entityIds};
}

const streetSignature = roads => JSON.stringify((roads ?? []).map(road => road.properties.entityId).sort());

// Joins are recomputed only for a building whose address changed or whose street gained, lost or renamed a road, so a
// changeset does not rewrite the joins of the whole city.
export function buildingsFollowingStreets(buildings, previousBuildings, roads, previousRoads) {
  const groups = roadsByStreet(roads);
  const previousGroups = roadsByStreet(previousRoads);
  const previousByKey = new Map(previousBuildings.features.map(feature => [entityKey(feature.properties), feature]));
  const features = buildings.features.map(building => {
    const {properties} = building;
    const previousStreet = previousByKey.get(entityKey(properties))?.properties['addr:street'];
    const streetName = properties['addr:street'];
    const street = streetName === undefined ? null : normalizedStreet(streetName);
    const isSameStreet = previousStreet === streetName;
    const isSameGroup = streetSignature(groups.get(street)) === streetSignature(previousGroups.get(street));
    if (isSameStreet && isSameGroup) return building;
    const withoutJoin = {...properties};
    delete withoutJoin['addr:streetEntityId'];
    delete withoutJoin['addr:streetEntityIds'];
    return {...building, properties: {...withoutJoin, ...streetJoin(groups.get(street))}};
  });
  return {...buildings, features};
}

function checkedSummit(summit) {
  const {ele, demElevation, ...properties} = summit.properties;
  if (!Number.isFinite(demElevation)) return summit;
  const isMissing = ele === null;
  const differenceMetres = isMissing ? 0 : Math.abs(ele - demElevation);
  const reason = `Elevation differs from DEM by ${Math.round(differenceMetres)} m`;
  const reasons = differenceMetres > summitMismatchMetres ? [reason] : [];
  const heightCheck = isMissing ? 'missing' : reasons.length > 0 ? 'mismatch' : 'ok';
  return {
    ...summit,
    properties: {
      ...properties,
      ele,
      demElevation,
      heightCheck,
      mismatch: reasons.length > 0,
      mismatchReasons: reasons
    }
  };
}

// A reviewed height replaces the mapped one, so it is compared with the terrain model again.
export function summitsWithCheckedHeights(summits, changedKeys, previousSummits) {
  const previousByKey = new Map(previousSummits.features.map(feature => [entityKey(feature.properties), feature]));
  const features = summits.features.map(summit => {
    const key = entityKey(summit.properties);
    const isHeightChange = changedKeys.has(key) && previousByKey.get(key)?.properties.ele !== summit.properties.ele;
    return isHeightChange ? checkedSummit(summit) : summit;
  });
  return {...summits, features};
}

// The relief contract runs every contour with higher ground on its left. A changed height can turn that around.
export function contoursFacingUphill(contours, summits, changedKeys) {
  const reversed = new Set(reversedClosedContours(contours, summits).reversed);
  const features = contours.features.map(contour => {
    const isWrongWay = reversed.has(contour) && changedKeys.has(entityKey(contour.properties));
    if (!isWrongWay) return contour;
    return {...contour, geometry: {...contour.geometry, coordinates: contour.geometry.coordinates.toReversed()}};
  });
  return {...contours, features};
}

const metricPoint = ([longitude, latitude], referenceLatitude) => [
  longitude * metresPerDegreeLatitude * Math.cos((referenceLatitude * Math.PI) / 180),
  latitude * metresPerDegreeLatitude
];

function ringAreaSquareMetres(ring) {
  const points = ring.map(point => metricPoint(point, ring[0][1]));
  const twiceArea = points.slice(1).reduce((area, end, index) => {
    const start = points[index];
    return area + start[0] * end[1] - end[0] * start[1];
  }, 0);
  return Math.abs(twiceArea) / 2;
}

function polygonAreaSquareMetres([outerRing, ...holes]) {
  return holes.reduce((area, hole) => area - ringAreaSquareMetres(hole), ringAreaSquareMetres(outerRing));
}

function lineLengthMetres(line) {
  const points = line.map(point => metricPoint(point, line[0][1]));
  return points
    .slice(1)
    .reduce((length, end, index) => length + Math.hypot(end[0] - points[index][0], end[1] - points[index][1]), 0);
}

const measureByFile = {
  'slopes.geojson': ({coordinates}) => ({areaSquareMetres: Math.round(polygonAreaSquareMetres(coordinates))}),
  'canyon-rims.geojson': ({coordinates}) => ({lengthMetres: Math.round(lineLengthMetres(coordinates))})
};

// A changed slope or rim states its new measure.
export function featuresWithMeasures(filename, collection, changedKeys) {
  const measure = measureByFile[filename];
  if (!measure) return collection;
  const features = collection.features.map(feature => {
    if (!changedKeys.has(entityKey(feature.properties))) return feature;
    return {...feature, properties: {...feature.properties, ...measure(feature.geometry)}};
  });
  return {...collection, features};
}

function signedRingArea(ring) {
  return ring.slice(1).reduce((area, end, index) => area + ring[index][0] * end[1] - end[0] * ring[index][1], 0);
}

const orientedPolygon = rings =>
  rings.map((ring, index) => {
    const isCounterclockwise = signedRingArea(ring) > 0;
    const isOuterRing = index === 0;
    return isCounterclockwise === isOuterRing ? ring : ring.toReversed();
  });

const ringOrderFiles = new Set(['land.geojson', 'water.geojson']);

// Someone draws a shape in either direction; the published ring order is the one of RFC 7946.
export function featuresWithRingOrder(filename, collection, changedKeys) {
  if (!ringOrderFiles.has(filename)) return collection;
  const features = collection.features.map(feature => {
    const isDrawn = changedKeys.has(entityKey(feature.properties)) && feature.geometry.type === 'Polygon';
    if (!isDrawn) return feature;
    return {...feature, geometry: {...feature.geometry, coordinates: orientedPolygon(feature.geometry.coordinates)}};
  });
  return {...collection, features};
}

// Every derived fact of the changed files. `next` holds the edited collections by file name, `previous` the reviewed
// ones; `read` returns the collection of a file the changeset did not change. Returns the files to write.
export function withDerivedFacts(next, previous, changedKeysByFile, read) {
  const derived = new Map();
  for (const [filename, collection] of next) {
    const changedKeys = changedKeysByFile.get(filename);
    const ordered = featuresWithRingOrder(filename, collection, changedKeys);
    derived.set(filename, featuresWithMeasures(filename, ordered, changedKeys));
  }
  const current = filename => derived.get(filename) ?? read(filename);
  const reviewed = filename => previous.get(filename) ?? read(filename);
  if (derived.has(roadsFile) || derived.has(buildingsFile)) {
    const buildings = buildingsFollowingStreets(
      current(buildingsFile),
      reviewed(buildingsFile),
      current(roadsFile),
      reviewed(roadsFile)
    );
    const hasChangedJoin = buildings.features.some((feature, index) => feature !== current(buildingsFile).features[index]);
    if (hasChangedJoin || derived.has(buildingsFile)) derived.set(buildingsFile, buildings);
  }
  if (derived.has(summitsFile)) {
    const changedKeys = changedKeysByFile.get(summitsFile);
    derived.set(summitsFile, summitsWithCheckedHeights(derived.get(summitsFile), changedKeys, reviewed(summitsFile)));
  }
  if (derived.has(contoursFile)) {
    const changedKeys = changedKeysByFile.get(contoursFile);
    derived.set(contoursFile, contoursFacingUphill(derived.get(contoursFile), current(summitsFile), changedKeys));
  }
  return derived;
}
