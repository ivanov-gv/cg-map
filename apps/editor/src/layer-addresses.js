// Addresses: a house number and a street that belong to one building. Buildings without a number can be filled in one
// after another.
import {createElementWithText} from './dom.js';
import {distanceMetres} from './geometry-measures.js';
import {interiorPoint, isInside} from './interior-point.js';
import {addressText, buildingId} from './object-names.js';

const buildingsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';
const addressNames = ['addr:housenumber', 'addr:street'];
// Facts of a label that come from the map of entrances, so it cannot simply be given to another building.
const locatedFactNames = ['entrances', 'building_number', 'lamela'];

export function buildingOfLabel({properties}, context) {
  if (properties.buildingEntityId !== undefined) return context.findEntity(buildingsFile, properties.buildingEntityId);
  const key = String(properties.footprintIndex);
  return context.entriesOf(buildingsFile).find(building => building.key === key);
}

function labelOfBuilding(building, context) {
  const isOfBuilding = ({feature}) => buildingOfLabel(feature, context)?.key === building.key;
  return context.entriesOf(labelsFile).find(isOfBuilding);
}

function withValues(properties, values) {
  const next = {...properties};
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete next[name];
    else next[name] = value;
  }
  return next;
}

const isSameAddress = (first, second) => addressNames.every(name => first[name] === second[name]);

// The building carries the same address, so one edit keeps both in step.
function buildingEdit({feature, before}, context) {
  const building = buildingOfLabel(feature, context);
  const isUnchanged = before && isSameAddress(before.properties, feature.properties);
  if (!building || isUnchanged) return [];
  const values = Object.fromEntries(addressNames.map(name => [name, feature.properties[name]]));
  const properties = withValues(building.feature.properties, {...values, nohousenumber: undefined});
  return [{filename: buildingsFile, key: building.key, after: {...building.feature, properties}}];
}

// "bb" in the field: the building says it has no number and its address goes.
function noNumberEdits(label, context) {
  const building = buildingOfLabel(label.feature, context);
  const withoutNumber = withValues(label.feature.properties, {'addr:housenumber': undefined});
  const keepsLabel = locatedFactNames.some(name => withoutNumber[name] !== undefined);
  const labelEdit = {
    filename: labelsFile,
    key: label.key,
    after: keepsLabel ? {...label.feature, properties: withoutNumber} : null
  };
  if (!building) return [labelEdit];
  const properties = withValues(building.feature.properties, {'addr:housenumber': undefined, nohousenumber: 'yes'});
  return [labelEdit, {filename: buildingsFile, key: building.key, after: {...building.feature, properties}}];
}

// An address that belongs to another building is a new one there.
async function moveToBuilding(edit) {
  const {context, key} = edit;
  const isLocated = locatedFactNames.some(name => edit.feature.properties[name] !== undefined);
  if (isLocated) {
    edit.showProblem('This address is located by the entrances of its building and cannot move to another one.');
    return;
  }
  const target = await context.pick(buildingsFile, 'Pick the building this address belongs to');
  if (!target || !edit.isOpen()) return;
  const previous = buildingOfLabel(edit.feature, context);
  if (target.key === previous?.key) return;
  if (labelOfBuilding(target, context)) {
    edit.showProblem('That building already has an address. Change or delete it first.');
    return;
  }
  const feature = edit.typedFeature();
  const properties = {kind: 'building', buildingEntityId: buildingId(target)};
  for (const name of addressNames) {
    if (feature.properties[name] !== undefined) properties[name] = feature.properties[name];
  }
  const geometry = {type: 'Point', coordinates: interiorPoint(target.feature.geometry.coordinates)};
  const address = Object.fromEntries(addressNames.map(name => [name, properties[name]]));
  const edits = [
    {filename: labelsFile, key, after: null},
    {filename: labelsFile, key: `local:${crypto.randomUUID()}`, after: {type: 'Feature', properties, geometry}},
    {
      filename: buildingsFile,
      key: target.key,
      after: {...target.feature, properties: withValues(target.feature.properties, {...address, nohousenumber: undefined})}
    }
  ];
  if (previous) {
    const cleared = withValues(previous.feature.properties, {'addr:housenumber': undefined, 'addr:street': undefined});
    edits.push({filename: buildingsFile, key: previous.key, after: {...previous.feature, properties: cleared}});
  }
  edit.replaceWith(edits, `Applied · ${addressText(properties)}`);
}

function renderAddressExtras(container, edit) {
  const {context, key, feature} = edit;
  const building = buildingOfLabel(feature, context);
  const levels = building?.feature.properties['building:levels'];
  const buildingText = ['Belongs to: building', levels && `${levels} levels`].filter(Boolean).join(' · ');
  const change = createElementWithText('button', 'Change building');
  const noNumber = createElementWithText('button', 'Building has no number');
  for (const button of [change, noNumber]) button.type = 'button';
  change.onclick = () => moveToBuilding(edit);
  noNumber.onclick = () => edit.replaceWith(noNumberEdits({key, feature}, context), 'Applied · no number');
  const row = document.createElement('div');
  row.className = 'button-row';
  row.append(change, noNumber);
  const hint = createElementWithText('p', 'Not a number: bb, bez broja, na, ?. Then the building has no number.');
  hint.className = 'hint';
  container.append(createElementWithText('p', buildingText), row, hint);
}

// An address stays inside its building: a drag past the wall stops where it was.
function addressInside(geometry, {feature, previousGeometry}, context) {
  const building = buildingOfLabel(feature, context);
  if (!building) return geometry;
  return isInside(geometry.coordinates, building.feature.geometry.coordinates) ? geometry : previousGeometry;
}

// Keys of the buildings that already have an address on the map.
function addressedBuildingKeys(context) {
  const keys = new Set();
  for (const {feature} of context.entriesOf(labelsFile)) {
    const {footprintIndex, buildingEntityId} = feature.properties;
    keys.add(buildingEntityId ?? String(footprintIndex));
  }
  return keys;
}

// The buildings whose number is unknown: no number, no address on the map and not marked as having none.
export function buildingsWithoutNumber(context) {
  const addressedKeys = addressedBuildingKeys(context);
  return context.entriesOf(buildingsFile).filter(entry => {
    const {properties} = entry.feature;
    const isAddressed = addressedKeys.has(entry.key) || addressedKeys.has(properties.entityId);
    return !isAddressed && properties['addr:housenumber'] === undefined && properties.nohousenumber !== 'yes';
  });
}

// The gap nearest to a place, other than the ones left out.
export function nearestGap(gaps, coordinate, skippedKeys = new Set()) {
  let nearest = null;
  for (const entry of gaps) {
    if (skippedKeys.has(entry.key)) continue;
    const distance = distanceMetres(entry.feature.geometry.coordinates[0][0], coordinate);
    if (!nearest || distance < nearest.distance) nearest = {entry, distance};
  }
  return nearest?.entry ?? null;
}

export const addressBehaviors = {
  [labelsFile]: {
    title: feature => addressText(feature.properties) || feature.properties.building_number || 'Address',
    sections: () => [{title: 'Address', fields: ['addr:housenumber', 'addr:street']}],
    companionEdits: buildingEdit,
    renderExtras: renderAddressExtras,
    limitedGeometry: addressInside,
    deletion: ({key, feature}, context) => ({
      message: 'The building stays and has no number on the map.',
      edits: noNumberEdits({key, feature}, context).filter(({filename}) => filename === buildingsFile).map(edit => ({
        ...edit,
        after: {...edit.after, properties: withValues(edit.after.properties, {nohousenumber: undefined})}
      }))
    })
  }
};

// While filling gaps a building asks only for its address, and saving goes on to the nearest next gap.
function renderGapExtras(container, edit) {
  const skip = createElementWithText('button', 'Skip');
  skip.type = 'button';
  skip.onclick = () => {
    const {context, key, feature} = edit;
    edit.discard();
    context.showNextGap(feature, key);
  };
  const hint = createElementWithText('p', 'Enter saves and jumps to the next one.');
  hint.className = 'hint';
  container.append(skip, hint);
}

export const gapBehaviors = {
  [buildingsFile]: {
    sections: () => [{title: 'Add a number', fields: ['addr:housenumber', 'addr:street', 'nohousenumber']}],
    renderExtras: renderGapExtras,
    applyLabel: () => 'Save and next',
    afterApply: ({feature}, context) => context.showNextGap(feature)
  }
};

// Tools of the layer that show other objects instead of its own.
export const layerFilters = {
  addresses: [
    {
      id: 'fill-gaps',
      label: 'Fill the gaps',
      heading: 'Buildings without a number',
      filename: buildingsFile,
      entries: buildingsWithoutNumber,
      state: 'missing'
    }
  ]
};
