// Places inside a building and points that stand on their own. A place belongs to the building it is on.
import {createElementWithText} from '../../shared/dom.js';
import {geometryAreaSquareMetres} from '../../geometry/geometry-measures.js';
import {isInside} from '../../geometry/interior-point.js';
import {chosenField} from '../../inspector/form-controls.js';
import {byFrequency} from '../../inspector/usual-values.js';
import {addressText, buildingId, objectName} from '../shared/object-names.js';

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
  const text = building ? `Inside ${buildingName(building)}` : 'Stands on its own, not inside a building';
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
      return building && {feature: building.feature, label: `Inside ${buildingName(building)}`};
    }
  }
};

const roadsFile = 'roads.geojson';

function chooseBuilding(entries, onChosen) {
  const dialog = document.createElement('dialog');
  dialog.className = 'river-dialog';
  dialog.append(createElementWithText('h2', 'Choose a building'));
  const buildings = entries
    .filter(({feature}) => feature.geometry?.type === 'Polygon')
    .sort((first, second) => buildingName(first).localeCompare(buildingName(second)));
  for (const entry of buildings) {
    const button = createElementWithText('button', buildingName(entry));
    button.type = 'button';
    button.onclick = () => {
      dialog.close();
      onChosen(buildingId(entry));
    };
    dialog.append(button);
  }
  const cancel = createElementWithText('button', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  dialog.append(cancel);
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog);
  dialog.showModal();
}

function chooseStreet(entries, onChosen) {
  const dialog = document.createElement('dialog');
  dialog.className = 'river-dialog';
  dialog.append(createElementWithText('h2', 'Choose a street'));
  const streets = entries
    .filter(({feature}) => feature.properties.kind === 'street')
    .sort((first, second) => objectName(first.feature, roadsFile).localeCompare(objectName(second.feature, roadsFile)));
  for (const entry of streets) {
    const button = createElementWithText('button', objectName(entry.feature, roadsFile));
    button.type = 'button';
    button.onclick = () => {
      dialog.close();
      onChosen(entry.feature.properties.entityId ?? entry.key);
    };
    dialog.append(button);
  }
  const cancel = createElementWithText('button', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  dialog.append(cancel);
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog);
  dialog.showModal();
}

function buildingField(value, context) {
  return chosenField(
    'buildingEntityId',
    value,
    'Choose',
    (_current, onChosen) => chooseBuilding(context.entriesOf(buildingsFile), onChosen),
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
  const fields = ['name', 'name:en', 'kind'];
  if (properties.visibilityOverride !== undefined) fields.push('visibilityOverride');
  return [
    {title: '', fields},
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

function buildingExists(entityId, context) {
  return context.entriesOf(buildingsFile).some(({key, feature}) => key === entityId || feature.properties.entityId === entityId);
}

function streetExists(entityId, context) {
  return context.entriesOf(roadsFile).some(
    ({key, feature}) => feature.properties.kind === 'street' && (key === entityId || feature.properties.entityId === entityId)
  );
}

function version5PlaceProblem(change, context) {
  const {buildingEntityId, 'addr:streetEntityId': streetEntityId} = change.feature.properties;
  if (buildingEntityId !== undefined && !buildingExists(buildingEntityId, context)) {
    return 'buildingEntityId must name a building in buildings.geojson';
  }
  if (streetEntityId !== undefined && !streetExists(streetEntityId, context)) {
    return 'addr:streetEntityId must name a street object in roads.geojson';
  }
  return null;
}

function renderVersion5Where(container, {feature, context}) {
  if (!feature.geometry) return;
  const buildingIdValue = feature.properties.buildingEntityId;
  const building = buildingIdValue ? context.findEntity(buildingsFile, buildingIdValue) : null;
  const text = building ? `Inside ${buildingName(building)}` : 'Stands on its own, not inside a building';
  const where = createElementWithText('p', `${text}. Pick a building to link it.`);
  where.className = 'hint';
  container.append(where);
}

export const version5PlaceBehaviors = {
  [placesFile]: {
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
    problem: version5PlaceProblem,
    renderExtras: renderVersion5Where
  }
};
