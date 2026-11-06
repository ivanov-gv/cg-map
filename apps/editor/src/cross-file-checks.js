import {pointInsidePolygon} from './geometry-validation.js';

const footprintsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';

// Footprint and label edits never rewrite each other, so a label left outside its footprint is reported here and
// corrected explicitly in its own mode. footprintIndex is a revision-bound index, and footprints cannot be
// added or deleted, so the join stays valid throughout a session.
export function labelJoinProblems(session) {
  const changedFootprints = new Set(session.changes(footprintsFile).map(({reference}) => reference.featureIndex));
  const changedLabelKeys = new Set(session.changes(labelsFile).map(({reference}) => String(reference.featureIndex)));
  if (changedFootprints.size === 0 && changedLabelKeys.size === 0) return [];
  const footprints = session.workingEntries(footprintsFile).map(({feature}) => feature);
  const problems = [];
  for (const {key, feature: label} of session.workingEntries(labelsFile)) {
    const {footprintIndex} = label.properties;
    const isAffected = changedLabelKeys.has(key) || changedFootprints.has(footprintIndex);
    if (!isAffected) continue;
    const footprint = footprints[footprintIndex];
    const isInside = footprint && pointInsidePolygon(label.geometry.coordinates, footprint.geometry.coordinates);
    if (isInside) continue;
    const message = `Label ${label.properties['addr:housenumber']} (feature ${key}) is outside footprint ${footprintIndex}.`;
    problems.push({filename: labelsFile, message});
  }
  return problems;
}
