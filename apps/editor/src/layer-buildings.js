// Buildings with what belongs to them: their address, their entrances on the outline and the places inside.
import {createElementWithText, elementById} from './dom.js';
import {roundedCoordinate, translateGeometry} from './geometry-editing.js';
import {nearestPointOnOutline} from './geometry-measures.js';
import {interiorPoint, isInside} from './interior-point.js';
import {addressText} from './object-names.js';

const buildingsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';
const entrancesFile = 'building-entrances.geojson';
const placesFile = 'places.geojson';
const addressNames = ['addr:street', 'addr:housenumber'];
// A corner that moved less than this, in degrees, only differs by rounding.
const roundingToleranceDegrees = 1e-6;

const buildingId = ({key, feature}) => feature.properties.entityId ?? key;

// A source label names its building by position; one added here names it by ID.
function isLabelOf(label, building) {
  const {footprintIndex, buildingEntityId} = label.feature.properties;
  if (buildingEntityId !== undefined) return buildingEntityId === buildingId(building);
  return String(footprintIndex) === building.key;
}

export const labelOf = (building, context) => context.entriesOf(labelsFile).find(label => isLabelOf(label, building));

const belongingTo = (filename, building, context) =>
  context.entriesOf(filename).filter(({feature}) => feature.properties.buildingEntityId === buildingId(building));

export const entrancesOf = (building, context) => belongingTo(entrancesFile, building, context);
export const placesInside = (building, context) => belongingTo(placesFile, building, context);

// How far a shape was moved as a whole, or null when its corners changed relative to each other.
function wholeOffset(before, after) {
  const [firstRing, nextRing] = [before.coordinates[0], after.coordinates[0]];
  if (firstRing.length !== nextRing.length) return null;
  const offset = [0, 1].map(axis => nextRing[0][axis] - firstRing[0][axis]);
  const isMovedAlike = firstRing.every((corner, index) =>
    [0, 1].every(axis => Math.abs(nextRing[index][axis] - corner[axis] - offset[axis]) < roundingToleranceDegrees)
  );
  return isMovedAlike ? offset : null;
}

const withProperty = (properties, name, value) => {
  const next = {...properties};
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
};

// The address of a building is also its label on the map, so one edit keeps both in step.
function labelWithAddress(label, building, previousBuilding) {
  let {properties} = label;
  for (const name of addressNames) {
    const value = building.properties[name];
    if (value !== previousBuilding?.properties[name]) properties = withProperty(properties, name, value);
  }
  return {...label, properties};
}

function movedEntrances(entrances, geometry, offset) {
  return entrances.map(entrance => {
    const moved = offset
      ? translateGeometry({type: 'Point', coordinates: entrance.coordinates}, ...offset).coordinates
      : entrance.coordinates;
    return {...entrance, coordinates: roundedCoordinate(nearestPointOnOutline(moved, geometry.coordinates).coordinate)};
  });
}

// A label stays inside its building and its located entrances stay on the wall.
function labelWithShape(label, geometry, offset) {
  const moved = offset ? translateGeometry(label.geometry, ...offset) : label.geometry;
  const anchor = isInside(moved.coordinates, geometry.coordinates)
    ? moved.coordinates
    : roundedCoordinate(interiorPoint(geometry.coordinates));
  const {entrances} = label.properties;
  const properties = entrances
    ? {...label.properties, entrances: movedEntrances(entrances, geometry, offset)}
    : label.properties;
  return {...label, properties, geometry: {...label.geometry, coordinates: anchor}};
}

function hasLabelContent({properties}) {
  return Boolean(properties['addr:housenumber'] ?? properties.building_number ?? properties.entrances?.length);
}

function newLabel(building, entityId) {
  const properties = {kind: 'building', buildingEntityId: entityId};
  for (const name of addressNames) {
    if (building.properties[name] !== undefined) properties[name] = building.properties[name];
  }
  const coordinates = roundedCoordinate(interiorPoint(building.geometry.coordinates));
  return {type: 'Feature', properties, geometry: {type: 'Point', coordinates}};
}

// The label edit that follows from a building edit, if any.
function labelEdit({key, feature, before}, context) {
  const entry = {key, feature: before ?? feature};
  const label = labelOf(entry, context);
  if (!label) {
    if (feature.properties['addr:housenumber'] === undefined) return [];
    const labelKey = `local:${crypto.randomUUID()}`;
    return [{filename: labelsFile, key: labelKey, after: newLabel(feature, buildingId({key, feature}))}];
  }
  const isReshaped = JSON.stringify(before.geometry) !== JSON.stringify(feature.geometry);
  const offset = isReshaped ? wholeOffset(before.geometry, feature.geometry) : null;
  const addressed = labelWithAddress(label.feature, feature, before);
  const next = isReshaped ? labelWithShape(addressed, feature.geometry, offset) : addressed;
  return [{filename: labelsFile, key: label.key, after: hasLabelContent(next) ? next : null}];
}

// What stands on or in a building goes with it when it moves. After a corner edit an entrance returns to the outline and
// a place that fell outside comes back in.
function belongingEdits({key, feature, before}, context) {
  if (!before || JSON.stringify(before.geometry) === JSON.stringify(feature.geometry)) return [];
  const building = {key, feature: before};
  const offset = wholeOffset(before.geometry, feature.geometry);
  const rings = feature.geometry.coordinates;
  const moved = geometry => (offset ? translateGeometry(geometry, ...offset) : geometry);
  const entranceEdits = entrancesOf(building, context).map(entrance => {
    const onWall = nearestPointOnOutline(moved(entrance.feature.geometry).coordinates, rings).coordinate;
    const geometry = {type: 'Point', coordinates: roundedCoordinate(onWall)};
    return {filename: entrancesFile, key: entrance.key, after: {...entrance.feature, geometry}};
  });
  const placeEdits = placesInside(building, context).map(place => {
    const geometry = moved(place.feature.geometry);
    const isStillInside = isInside(geometry.coordinates, rings);
    const coordinates = isStillInside ? geometry.coordinates : roundedCoordinate(interiorPoint(rings));
    return {filename: placesFile, key: place.key, after: {...place.feature, geometry: {...geometry, coordinates}}};
  });
  return [...entranceEdits, ...placeEdits];
}

// A building with a number cannot also have none.
function preparedBuilding(feature) {
  if (feature.properties.nohousenumber !== 'yes') return feature;
  return {...feature, properties: withProperty(feature.properties, 'addr:housenumber', undefined)};
}

function rowButton(title, detail, run) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'related-row';
  button.append(createElementWithText('strong', title), createElementWithText('span', detail));
  button.onclick = run;
  return button;
}

function actionButton(label, run) {
  const button = createElementWithText('button', label);
  button.type = 'button';
  button.className = 'related-action';
  button.onclick = run;
  return button;
}

function relatedSection(title, rows, action) {
  const section = document.createElement('section');
  section.append(createElementWithText('h3', `${title} · ${rows.length}`), ...rows, action);
  section.firstChild.className = 'section-title';
  return section;
}

const entranceDetail = ({properties}) =>
  [addressText(properties), properties.level && `level ${properties.level}`, properties.wheelchair === 'yes' && 'step-free']
    .filter(Boolean)
    .join(' · ');

const placeDetail = ({properties}) => [properties.kind, properties.level && `floor ${properties.level}`].filter(Boolean).join(' · ');

function nextEntranceNumber(entrances) {
  const numbers = entrances.map(({feature}) => Number(feature.properties.ref)).filter(Number.isInteger);
  return String(Math.max(0, ...numbers) + 1);
}

function startEntrance(building, context) {
  const {properties} = building.feature;
  const address = Object.fromEntries(
    addressNames.filter(name => properties[name] !== undefined).map(name => [name, properties[name]])
  );
  context.startNew({
    label: 'Add entrance',
    filename: entrancesFile,
    shape: 'Point',
    properties: {
      kind: 'entrance',
      entrance: 'main',
      ref: nextEntranceNumber(entrancesOf(building, context)),
      buildingEntityId: buildingId(building),
      ...address
    }
  });
}

function startPlace(building, context) {
  context.startNew({
    label: 'Add place',
    filename: placesFile,
    shape: 'Point',
    properties: {buildingEntityId: buildingId(building)},
    geometry: {type: 'Point', coordinates: roundedCoordinate(interiorPoint(building.feature.geometry.coordinates))}
  });
}

// The form is already open, so this leads to where the address is typed.
function focusHouseNumber() {
  elementById('property-form').querySelector('[name="addr:housenumber"]').focus();
}

// Entrances and places belong to a building that exists, so a new one is applied first.
function renderBelongings(container, edit) {
  const {context, key, feature, isNew} = edit;
  if (isNew) {
    container.append(createElementWithText('p', 'Not on the map until you apply it. Entrances and places come after.'));
    if (!addressText(feature.properties)) container.append(actionButton('Add address', focusHouseNumber));
    return;
  }
  const building = {key, feature};
  const whenIdle = run => () => {
    if (edit.hasUnappliedEdit()) edit.showProblem('Apply or Cancel this building first.');
    else run();
  };
  const entrances = entrancesOf(building, context);
  const places = placesInside(building, context);
  const entranceRows = entrances.map(entry =>
    rowButton(`Entrance ${entry.feature.properties.ref ?? ''}`.trim(), entranceDetail(entry.feature), whenIdle(() => context.select(entry)))
  );
  const placeRows = places.map(entry =>
    rowButton(entry.feature.properties.name, placeDetail(entry.feature), whenIdle(() => context.select(entry)))
  );
  container.append(
    relatedSection('Entrances', entranceRows, actionButton('Add entrance', whenIdle(() => startEntrance(building, context)))),
    relatedSection('Places inside', placeRows, actionButton('Add place', whenIdle(() => startPlace(building, context))))
  );
}

const deletionsOf = entries => entries.map(({filename, key}) => ({filename, key, after: null}));

async function placesMovedElsewhere(building, places, context) {
  const target = await context.pick(buildingsFile, 'Pick the building the places move to');
  if (!target || target.key === building.key) return null;
  const coordinates = roundedCoordinate(interiorPoint(target.feature.geometry.coordinates));
  return places.map(({filename, key, feature}) => ({
    filename,
    key,
    after: {
      ...feature,
      properties: {...feature.properties, buildingEntityId: buildingId(target)},
      geometry: {type: 'Point', coordinates}
    }
  }));
}

// The address and the entrances go with the building. What happens to the places inside is asked.
function buildingDeletion(building, context) {
  const label = labelOf(building, context);
  const places = placesInside(building, context);
  const edits = deletionsOf([...(label ? [label] : []), ...entrancesOf(building, context)]);
  if (places.length === 0) return {message: 'The address and the entrances go with the building.', edits};
  const names = places.map(({feature}) => feature.properties.name).join(', ');
  return {
    message: `Inside: ${names}. The address and the entrances go with the building.`,
    edits,
    options: [
      {
        label: 'Move the places to another building: pick it on the map',
        resolve: () => placesMovedElsewhere(building, places, context)
      },
      {label: 'Delete the places too', edits: deletionsOf(places)}
    ]
  };
}

function buildingSections({properties}) {
  return [
    {title: 'Address', fields: ['addr:street', 'addr:housenumber', 'nohousenumber']},
    {title: 'Building', fields: ['building:levels', 'building:material', 'start_date', 'energy_class']},
    {
      title: 'More',
      fields: ['name', 'building', 'roof:levels'],
      isCollapsed: properties.name === undefined
    }
  ];
}

const buildingOfEntrance = (entrance, context) =>
  context.findEntity(buildingsFile, entrance.properties.buildingEntityId)?.feature;

function pointOnWall(coordinate, entrance, context) {
  const building = buildingOfEntrance(entrance, context);
  if (!building) return coordinate;
  return roundedCoordinate(nearestPointOnOutline(coordinate, building.geometry.coordinates).coordinate);
}

export const buildingBehaviors = {
  [buildingsFile]: {
    title: feature => addressText(feature.properties) || feature.properties.name || 'No address',
    sections: buildingSections,
    prepared: preparedBuilding,
    renderExtras: renderBelongings,
    companionEdits: (edit, context) => [...labelEdit(edit, context), ...belongingEdits(edit, context)],
    deletion: buildingDeletion
  },
  [entrancesFile]: {
    title: ({properties}) => `Entrance ${properties.ref ?? ''}`.trim(),
    sections: () => [
      {title: 'Entrance', fields: ['entrance', 'ref', 'level', 'opens_onto', 'wheelchair']},
      {title: 'Address', fields: ['addr:street', 'addr:housenumber', 'nohousenumber']},
      {title: 'More', fields: ['door'], isCollapsed: true}
    ],
    prepared: preparedBuilding,
    // An entrance is always on the outline of its building, wherever it is put or dragged.
    snappedPoint: (event, context, entrance) => pointOnWall(event.lngLat.toArray(), entrance, context),
    limitedGeometry: (geometry, {feature}, context) => ({
      ...geometry,
      coordinates: pointOnWall(geometry.coordinates, feature, context)
    })
  }
};
