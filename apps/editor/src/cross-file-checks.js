import {pointInsidePolygon} from './geometry-validation.js';

const footprintsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';

// A source label names its building by position in the snapshot, which is the session key; one added here by entity ID.
function footprintKeyOf(label, session) {
  const {footprintIndex, buildingEntityId} = label.properties;
  if (buildingEntityId === undefined) return String(footprintIndex);
  if (buildingEntityId.startsWith('local:')) return buildingEntityId;
  const entry = session
    .workingEntries(footprintsFile)
    .find(({feature}) => feature.properties.entityId === buildingEntityId);
  return entry?.key ?? null;
}

// Keys of the footprints and labels with pending changes.
function changedKeys(session, filename) {
  const keyOf = ({reference}) => reference.localId ?? String(reference.featureIndex);
  return new Set(session.changes(filename).map(keyOf));
}

// Every label must be inside its building. The editor moves them together, so this reports what an import or an edit of
// the label alone left behind.
export function labelJoinProblems(session) {
  const changedFootprints = changedKeys(session, footprintsFile);
  const changedLabels = changedKeys(session, labelsFile);
  if (changedFootprints.size === 0 && changedLabels.size === 0) return [];
  const problems = [];
  for (const {key, feature: label} of session.workingEntries(labelsFile)) {
    const footprintKey = footprintKeyOf(label, session);
    const isAffected = changedLabels.has(key) || changedFootprints.has(footprintKey);
    if (!isAffected) continue;
    const footprint = footprintKey === null ? null : session.workingFeature(footprintsFile, footprintKey);
    const isInside = footprint && pointInsidePolygon(label.geometry.coordinates, footprint.geometry.coordinates);
    if (isInside) continue;
    const number = label.properties['addr:housenumber'] ?? label.properties.building_number ?? '';
    const message = footprint
      ? `Address ${number} (feature ${key}) is outside its building ${footprintKey}.`
      : `Address ${number} (feature ${key}) has no building.`;
    problems.push({filename: labelsFile, message});
  }
  return problems;
}
