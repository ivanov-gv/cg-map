// Places inside a building and points that stand on their own. A place belongs to the building it is on.
import {createElementWithText} from './dom.js';
import {geometryAreaSquareMetres} from './geometry-measures.js';
import {isInside} from './interior-point.js';
import {addressText, buildingId} from './object-names.js';

const buildingsFile = 'buildings.geojson';
const placesFile = 'places.geojson';

function mayContain([longitude, latitude], ring) {
  let isEast = false;
  let isWest = false;
  let isNorth = false;
  let isSouth = false;
  for (const corner of ring) {
    isEast ||= corner[0] >= longitude;
    isWest ||= corner[0] <= longitude;
    isNorth ||= corner[1] >= latitude;
    isSouth ||= corner[1] <= latitude;
  }
  return isEast && isWest && isNorth && isSouth;
}

// The building at a place. Where buildings overlap it is the smallest, as the data pipeline resolves it.
export function buildingAt(coordinate, context) {
  const containing = context.entriesOf(buildingsFile).filter(({feature}) => {
    const rings = feature.geometry.coordinates;
    return mayContain(coordinate, rings[0]) && isInside(coordinate, rings);
  });
  const areaOf = ({feature}) => geometryAreaSquareMetres(feature.geometry);
  return containing.sort((first, second) => areaOf(first) - areaOf(second))[0] ?? null;
}

const buildingName = ({feature}) => addressText(feature.properties) || feature.properties.name || 'a building';

// Older rules do not let a place say which building it is in.
const canBelongToBuilding = context => Boolean(context.rules.layers[placesFile].properties.buildingEntityId);

// A new or moved place says what it is in; one left where it was keeps what it says.
function placedFeature(feature, context, {isNew, key}) {
  if (!canBelongToBuilding(context) || !feature.geometry) return feature;
  const before = context.session.workingFeature(placesFile, key);
  const isMoved = JSON.stringify(before?.geometry) !== JSON.stringify(feature.geometry);
  if (!isNew && !isMoved) return feature;
  const building = buildingAt(feature.geometry.coordinates, context);
  const properties = {...feature.properties};
  delete properties.buildingEntityId;
  delete properties.standalone;
  if (building) properties.buildingEntityId = buildingId(building);
  else properties.standalone = true;
  return {...feature, properties};
}

function placeSections({properties}) {
  const hasMore = ['cuisine', 'wikidata', 'wikipedia', 'name:sr-Latn'].some(name => properties[name] !== undefined);
  return [
    {title: '', fields: ['name', 'name:en', 'category', 'kind', 'visibilityLevel']},
    {title: 'Where', fields: ['addr:street', 'addr:housenumber', 'level']},
    {title: 'Contacts', fields: ['phone', 'website', 'email']},
    {title: 'Open', fields: ['opening_hours', 'wheelchair']},
    {title: 'More', fields: ['name:sr-Latn', 'cuisine', 'wikidata', 'wikipedia'], isCollapsed: !hasMore}
  ];
}

function renderWhere(container, {feature, context}) {
  if (!feature.geometry) return;
  const building = buildingAt(feature.geometry.coordinates, context);
  const text = building ? `Inside ${buildingName(building)}` : 'Stands on its own, not inside a building';
  const where = createElementWithText('p', `${text}. Move it to change.`);
  where.className = 'hint';
  container.append(where);
}

// The kinds other places of the category have, most common first.
function kindSuggestions({properties}, context) {
  const counts = new Map();
  for (const {feature} of context.entriesOf(placesFile)) {
    const {category, kind} = feature.properties;
    if (properties.category === undefined || category === properties.category) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  }
  const kinds = [...counts].sort((first, second) => second[1] - first[1]).map(([kind]) => kind);
  return {kind: kinds};
}

export const placeBehaviors = {
  [placesFile]: {
    kind: ({properties}) => (properties.standalone ? 'Point' : 'Place'),
    sections: placeSections,
    suggestions: kindSuggestions,
    prepared: placedFeature,
    renderExtras: renderWhere,
    dragTarget(geometry, context) {
      const building = buildingAt(geometry.coordinates, context);
      return building && {feature: building.feature, label: `Inside ${buildingName(building)}`};
    }
  }
};
