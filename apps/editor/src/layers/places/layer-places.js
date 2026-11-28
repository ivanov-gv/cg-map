// Places inside a building and points that stand on their own. A place belongs to the building it is on.
import {createElementWithText} from '../../shared/dom.js';
import {defaultBehavior} from '../shared/layer-behaviors.js';
import {openEntityPickerDialog} from '../shared/entity-picker.js';
import {geometryAreaSquareMetres} from '../../geometry/geometry-measures.js';
import {isInside} from '../../geometry/interior-point.js';
import {chosenField} from '../../inspector/form-controls.js';
import {byFrequency} from '../../inspector/usual-values.js';
import {buildingId, objectName} from '../shared/object-names.js';

const buildingsFile = 'buildings.geojson';
const placesFile = 'places.geojson';

const usualCuisines = [
  'balkan',
  'barbecue',
  'burger',
  'chinese',
  'coffee_shop',
  'fish',
  'ice_cream',
  'indian',
  'international',
  'italian',
  'japanese',
  'pizza',
  'regional',
  'sandwich',
  'seafood',
  'turkish'
];

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

function isBuildingFeature(feature) {
  return feature.properties.kind === 'building' && feature.geometry?.type === 'Polygon';
}

// The building at a place. Where buildings overlap it is the smallest, as the data pipeline resolves it.
export function buildingAt(coordinate, context) {
  const containing = context.entriesOf(buildingsFile).filter(({feature}) => {
    if (!isBuildingFeature(feature)) return false;
    const rings = feature.geometry.coordinates;
    return mayContain(coordinate, rings[0]) && isInside(coordinate, rings);
  });
  const areaOf = ({feature}) => geometryAreaSquareMetres(feature.geometry);
  return containing.sort((first, second) => areaOf(first) - areaOf(second))[0] ?? null;
}

export function buildingLinkTarget(entityId, context) {
  const entry = context.findEntity(buildingsFile, entityId);
  return entry && isBuildingFeature(entry.feature) ? entry : null;
}

function buildingName(entry, context) {
  const {properties} = entry.feature;
  const streetId = properties['addr:streetEntityId'];
  const street = streetId && context ? streetLinkTarget(streetId, context) : null;
  const streetName = street ? (street.feature.properties.name ?? objectName(street.feature, roadsFile)) : properties['addr:street'];
  const address = [streetName, properties['addr:housenumber']].filter(Boolean).join(' ');
  return address || properties.name || 'a building';
}

// Older rules do not let a place say which building it is in.
const canBelongToBuilding = context => Boolean(context.rules.layers[placesFile].properties.buildingEntityId);

// A new or moved place says what it is in; one left where it was keeps what it says.
export function placedFeature(feature, context, {isNew, key}) {
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
  const text = building ? `Inside ${buildingName(building, context)}` : 'Stands on its own, not inside a building';
  const where = createElementWithText('p', `${text}. Move it to change.`);
  where.className = 'hint';
  container.append(where);
}

// The kinds other places of the category have, most common first.
function usualPlaceValues({properties}, context) {
  const isOfCategory = ({feature}) => properties.category === undefined || feature.properties.category === properties.category;
  const kinds = byFrequency(context.entriesOf(placesFile).filter(isOfCategory).map(({feature}) => feature.properties.kind));
  return {kind: kinds, cuisine: usualCuisines};
}

export const placeBehaviors = {
  [placesFile]: {
    kind: ({properties}) => (properties.standalone ? 'Point' : 'Place'),
    sections: placeSections,
    usualValues: usualPlaceValues,
    listsDependOn: ['category'],
    prepared: placedFeature,
    renderExtras: renderWhere,
    dragTarget(geometry, context) {
      const building = buildingAt(geometry.coordinates, context);
      return building && {feature: building.feature, label: `Inside ${buildingName(building, context)}`};
    }
  }
};

const roadsFile = 'roads.geojson';

function pickEntity(title, entries, labelOfEntry, valueOfEntry, onChosen) {
  openEntityPickerDialog(
    title,
    entries.map(entry => ({label: labelOfEntry(entry), value: valueOfEntry(entry)})),
    onChosen
  );
}

const entityIdOf = entry => entry.feature.properties.entityId ?? entry.key;

function buildingPickerLabel(entry, context) {
  const name = buildingName(entry, context);
  const id = entityIdOf(entry);
  return name === 'a building' ? `Building ${id}` : `${name} (${id})`;
}

function chooseBuilding(entries, context, onChosen) {
  const buildings = entries
    .filter(({feature}) => isBuildingFeature(feature))
    .sort((first, second) =>
      buildingPickerLabel(first, context).localeCompare(buildingPickerLabel(second, context))
    );
  pickEntity(
    'Choose a building',
    buildings,
    entry => buildingPickerLabel(entry, context),
    buildingId,
    onChosen
  );
}

function chooseStreet(entries, onChosen) {
  const streets = entries
    .filter(({feature}) => feature.geometry?.type === 'LineString')
    .sort((first, second) => objectName(first.feature, roadsFile).localeCompare(objectName(second.feature, roadsFile)));
  pickEntity(
    'Choose a street',
    streets,
    entry => objectName(entry.feature, roadsFile),
    entityIdOf,
    onChosen
  );
}

function buildingField(value, context) {
  return chosenField(
    'buildingEntityId',
    value,
    'Choose',
    (_current, onChosen) => chooseBuilding(context.entriesOf(buildingsFile), context, onChosen),
    'Clear'
  );
}

function streetEntityField(value, context) {
  return chosenField(
    'addr:streetEntityId',
    value,
    'Choose',
    (_current, onChosen) => chooseStreet(context.entriesOf(roadsFile), onChosen),
    'Clear'
  );
}

function version5PlaceSections({properties}) {
  const hasMore = ['cuisine', 'wikidata', 'wikipedia', 'name:sr-Latn'].some(name => properties[name] !== undefined);
  const where = ['addr:housenumber', 'level', 'buildingEntityId', 'addr:streetEntityId'];
  return [
    {title: '', fields: ['name', 'name:en', 'kind', 'visibilityOverride']},
    {title: 'Where', fields: where},
    {title: 'Contacts', fields: ['phone', 'website', 'email']},
    {title: 'Open', fields: ['opening_hours', 'wheelchair']},
    {title: 'More', fields: ['name:sr-Latn', 'cuisine', 'wikidata', 'wikipedia'], isCollapsed: !hasMore}
  ];
}

function version5UsualPlaceValues(_selection, context) {
  const kinds = byFrequency(context.entriesOf(placesFile).map(({feature}) => feature.properties.kind));
  return {kind: kinds, cuisine: usualCuisines};
}

function streetLinkTarget(entityId, context) {
  const entry = context.findEntity(roadsFile, entityId);
  return entry?.feature.geometry?.type === 'LineString' ? entry : null;
}

function featureAfterEdit(session, filename, edit) {
  const change = edit.after;
  if (change === null) {
    try {
      return session.baseFeature(filename, edit.key);
    } catch {
      return null;
    }
  }
  if (change && typeof change === 'object' && 'operation' in change && 'before' in change) return change.after;
  return change;
}

function proposedFileEntries(session, edits, filename) {
  let entries;
  try {
    entries = session.workingEntries(filename).map(entry => ({...entry}));
  } catch {
    return [];
  }
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  for (const edit of edits) {
    if (edit.filename !== filename) continue;
    const feature = featureAfterEdit(session, filename, edit);
    if (feature === null) byKey.delete(edit.key);
    else byKey.set(edit.key, {key: edit.key, feature});
  }
  return [...byKey.values()];
}

function proposedEntityIndex(session, edits, filename) {
  const entries = proposedFileEntries(session, edits, filename);
  const byId = new Map();
  for (const entry of entries) {
    byId.set(entry.key, entry);
    const entityId = entry.feature.properties.entityId;
    if (entityId !== undefined) byId.set(entityId, entry);
  }
  return {entries, byId};
}

export function version5PlaceLinkProblem(feature, context) {
  const {buildingEntityId, 'addr:streetEntityId': streetEntityId} = feature.properties;
  if (buildingEntityId !== undefined && !buildingLinkTarget(buildingEntityId, context)) {
    return 'buildingEntityId must name a building in buildings.geojson';
  }
  if (streetEntityId !== undefined && !streetLinkTarget(streetEntityId, context)) {
    return 'addr:streetEntityId must name a street object in roads.geojson';
  }
  return null;
}

// The proposed file state after edits, with entity lookups built once per file.
export function proposedPlaceLinkContext(session, edits) {
  const buildings = proposedEntityIndex(session, edits, buildingsFile);
  const roads = proposedEntityIndex(session, edits, roadsFile);
  const places = proposedFileEntries(session, edits, placesFile);
  const indexByFile = new Map([
    [buildingsFile, buildings.byId],
    [roadsFile, roads.byId]
  ]);
  return {
    places,
    findEntity: (filename, entityId) => indexByFile.get(filename)?.get(entityId) ?? null
  };
}

export function placeLinkResultProblemForEdits(session, context, edits) {
  if ((context?.bundleVersion ?? 3) < 5) return null;
  const relevant = edits.some(edit => [placesFile, buildingsFile, roadsFile].includes(edit.filename));
  if (!relevant) return null;
  const proposed = proposedPlaceLinkContext(session, edits);
  for (const {key, feature} of proposed.places) {
    const problem = version5PlaceLinkProblem(feature, proposed);
    if (problem) return `places.geojson: ${key}: ${problem}`;
  }
  return null;
}

function renderVersion5Where(container, {feature, context}) {
  if (!feature.geometry) return;
  const building = feature.properties.buildingEntityId
    ? buildingLinkTarget(feature.properties.buildingEntityId, context)
    : null;
  const text = building ? `Inside ${buildingName(building, context)}` : 'Stands on its own, not inside a building';
  const where = createElementWithText('p', `${text}. Pick a building to link it.`);
  where.className = 'hint';
  container.append(where);
}

export const version5PlaceBehaviors = {
  [placesFile]: {
    ...defaultBehavior(placesFile, null, 5),
    kind: () => 'Place',
    sections: version5PlaceSections,
    usualValues: version5UsualPlaceValues,
    controls: edit => ({
      buildingEntityId: value => buildingField(value, edit.context),
      'addr:streetEntityId': value => streetEntityField(value, edit.context)
    }),
    prepared: feature => {
      const properties = {...feature.properties};
      delete properties.id;
      delete properties.category;
      delete properties.visibilityLevel;
      delete properties.standalone;
      return {...feature, properties};
    },
    problem: (change, context) => version5PlaceLinkProblem(change.feature, context),
    renderExtras: renderVersion5Where
  }
};
