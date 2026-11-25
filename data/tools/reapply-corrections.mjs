// Replays the corrections ledger over freshly extracted sources, so an OpenStreetMap refresh never overrides a reviewed
// edit. An edit touches only what it changed: every other fact of the object keeps its refreshed value. What cannot be
// placed is reported, never dropped silently. See docs/runbooks/data.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyChangeset} from './apply-changeset.mjs';
import {entityKey, isLocalId} from './changeset-derivations.mjs';
import {checkOperationRules} from './changeset-rules.mjs';
import {parseSource} from './changeset-sources.mjs';
import {contractsDirectoryFrom, readContract} from './contracts.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcesPath = 'data/sources';
const ledgerPath = `${sourcesPath}/editor-corrections.json`;
const buildingsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';
const placesFile = 'places.geojson';
const addressFacts = ['addr:housenumber', 'addr:street', 'display_number'];
const buildingPartFiles = [labelsFile, 'building-entrances.geojson', placesFile];
// Positions and joins follow the sources; the importer computes them again.
const derivedNames = new Set(['footprintIndex', 'addr:streetEntityId', 'addr:streetEntityIds']);
const identityNames = new Set(['entityId', 'entityVersion', 'entityPart']);

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

const editedNames = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    name => !derivedNames.has(name) && !identityNames.has(name) && !isSameJSON(before[name], after[name])
  );

// The refreshed object with this correction on top, and the names where the refresh had changed the same fact.
function correctedFeature(current, {before, after}) {
  const properties = {...current.properties};
  const overridden = [];
  for (const name of editedNames(before.properties, after.properties)) {
    const isRefreshed =
      !isSameJSON(current.properties[name], before.properties[name]) &&
      !isSameJSON(current.properties[name], after.properties[name]);
    if (isRefreshed) overridden.push(name);
    if (after.properties[name] === undefined) delete properties[name];
    else properties[name] = after.properties[name];
  }
  const isReshaped = !isSameJSON(before.geometry, after.geometry);
  const isShapeRefreshed =
    isReshaped &&
    !isSameJSON(current.geometry, before.geometry) &&
    !isSameJSON(current.geometry, after.geometry);
  if (isShapeRefreshed) overridden.push('geometry');
  const geometry = isReshaped ? after.geometry : current.geometry;
  return {feature: {...current, properties, geometry}, overridden};
}

function withoutIdentity(feature) {
  const properties = Object.fromEntries(
    Object.entries(feature.properties).filter(([name]) => !identityNames.has(name))
  );
  return {...feature, properties};
}

// One object through every correction of it, in order. Returns the state the ledger asks for and what to report.
function replayedObject(filename, corrections, sourceFeature) {
  const report = [];
  let feature = sourceFeature;
  for (const correction of corrections) {
    const name = correction.reference.entityId ?? correction.reference.localId;
    if (correction.operation === 'add') {
      feature ??= withoutIdentity(correction.after);
      continue;
    }
    if (!feature) {
      report.push(`${filename} ${name}: gone from the refreshed sources, so this ${correction.operation} has no object`);
      continue;
    }
    if (correction.operation === 'delete') {
      feature = null;
      continue;
    }
    const {feature: corrected, overridden} = correctedFeature(feature, correction);
    feature = corrected;
    if (overridden.length > 0) report.push(`${filename} ${name}: kept the editor's ${overridden.join(', ')}`);
  }
  return {feature, report};
}

function operationReaching(filename, key, sourceFeature, feature) {
  if (isSameJSON(sourceFeature, feature)) return null;
  const [entityId, part] = key.split('#');
  if (!sourceFeature) {
    if (!feature) return null;
    const reference = {localId: entityId};
    return {filename, operation: 'add', reference, beforeFingerprint: null, before: null, after: feature};
  }
  return {
    filename,
    operation: feature ? 'modify' : 'delete',
    reference: part === '' ? {entityId} : {entityId, entityPart: Number(part)},
    beforeFingerprint: sha256(JSON.stringify(sourceFeature)),
    before: sourceFeature,
    after: feature
  };
}

// Corrections of one object, under the identity it has in the sources. Those bound to a snapshot cannot be followed.
function correctionsByObject(corrections) {
  const groups = new Map();
  const unfollowed = [];
  for (const correction of corrections) {
    const {reference, before, after} = correction;
    const properties = (before ?? after).properties;
    const entityId = reference.entityId ?? properties.entityId;
    if (entityId === undefined) {
      unfollowed.push(`${correction.filename} ${JSON.stringify(reference)}: has no entity ID to follow`);
      continue;
    }
    const key = `${correction.filename}:${entityKey({...properties, entityId})}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(correction);
  }
  return {groups, unfollowed};
}

// Label positions belong to a snapshot, so an added label is stated by its building again.
function restatedLabel(filename, feature, buildings) {
  const isAddedLabel = filename === labelsFile && feature && isLocalId(feature.id);
  if (!isAddedLabel) return feature;
  const restated = structuredClone(feature);
  const {properties} = restated;
  properties.buildingEntityId ??= buildings.features[properties.footprintIndex]?.properties.entityId;
  for (const name of ['footprintIndex', 'osm_id', 'address_sources']) delete properties[name];
  delete restated.id;
  return restated;
}

const nameOf = ({filename, reference}) => `${filename} ${reference.localId ?? entityKey(reference).replace(/#$/, '')}`;

// Shapes that share their edges, and lines with the stops that name them, hold only together.
const outlineFiles = new Set(['border-edges.geojson', 'municipalities.geojson']);
const outlineKinds = new Set(['country', 'ocean', 'coastline']);
const groupByFile = new Map([
  ['transport-stops.geojson', 'transport'],
  ['transit-routes.json', 'transport'],
  ['ridges.geojson', 'ridges'],
  ['slopes.geojson', 'ridges']
]);

// What is placed or refused together when not everything can be placed: a building with what is on it, the outlines, the
// transport lines, the ridges. Everything else stands alone.
function groupOf(operation, sourceBuildings) {
  const {filename, reference, before, after} = operation;
  const feature = after ?? before;
  if (filename === buildingsFile) return `building ${reference.localId ?? reference.entityId}`;
  if (outlineFiles.has(filename) || outlineKinds.has(feature.properties.kind)) return 'outlines';
  if (groupByFile.has(filename)) return groupByFile.get(filename);
  const buildingId = buildingPartFiles.includes(filename) ? buildingIdOf(filename, feature, sourceBuildings) : undefined;
  return buildingId === undefined ? nameOf(operation) : `building ${buildingId}`;
}

// Leaves out what the rules of today refuse, by name, so one such correction does not stop the others.
function allowedOperations(operations, {rules, levels}) {
  const report = [];
  const allowed = operations.filter(operation => {
    try {
      checkOperationRules(operation, rules, levels);
      return true;
    } catch (error) {
      report.push(`${nameOf(operation)}: left out, ${error.message}`);
      return false;
    }
  });
  return {operations: allowed, report};
}

// Which building an object belongs to, or undefined. A label of the sources states a position, an added one an ID.
function buildingIdOf(filename, {properties}, sourceBuildings) {
  if (filename !== labelsFile || properties.footprintIndex === undefined) return properties.buildingEntityId;
  return sourceBuildings[properties.footprintIndex]?.properties.entityId;
}

// What happens to a refreshed object whose building the ledger deleted: its address and entrances go with it, and a
// place stands on its own.
function withoutBuilding(filename, key, feature) {
  if (filename !== placesFile) return operationReaching(filename, key, feature, null);
  const properties = {...feature.properties, standalone: true};
  delete properties.buildingEntityId;
  return operationReaching(filename, key, feature, {...feature, properties});
}

// The address a building has in the refreshed sources, by building ID, unless a correction deletes it.
function refreshedLabels(operations, readSource, sourceBuildings) {
  const deletedNames = new Set(operations.filter(({operation}) => operation === 'delete').map(nameOf));
  const labels = [...readSource(labelsFile).values()].filter(
    ({properties}) => !deletedNames.has(`${labelsFile} ${properties.entityId}`)
  );
  return new Map(labels.map(label => [buildingIdOf(labelsFile, label, sourceBuildings), label]));
}

// An address added in the editor, on the one the refresh brought for the same building: a building has one address, and
// the editor's facts stand.
function addressOnRefreshedLabel({after}, label) {
  const facts = Object.fromEntries(addressFacts.map(name => [name, after.properties[name]]));
  const properties = {...label.properties};
  for (const [name, value] of Object.entries(facts)) {
    if (value !== undefined) properties[name] = value;
  }
  return operationReaching(labelsFile, entityKey(label.properties), label, {...label, properties});
}

// A building and the objects on it come from different files, so a refresh can leave one without the other.
function operationsKeepingBuildings(operations, readSource) {
  const sourceBuildings = [...readSource(buildingsFile).values()];
  const buildingOperations = operations.filter(({filename}) => filename === buildingsFile);
  const deletedIds = new Set(
    buildingOperations.filter(({operation}) => operation === 'delete').map(({reference}) => reference.entityId)
  );
  const knownIds = new Set([
    ...sourceBuildings.map(({properties}) => properties.entityId),
    ...buildingOperations.map(({reference}) => reference.localId ?? reference.entityId)
  ]);
  const report = [];
  const labelByBuilding = refreshedLabels(operations, readSource, sourceBuildings);
  const isBuildingKnown = ({filename, after}) => {
    if (!after || !buildingPartFiles.includes(filename)) return true;
    const buildingId = buildingIdOf(filename, after, sourceBuildings);
    return buildingId === undefined || (knownIds.has(buildingId) && !deletedIds.has(buildingId));
  };
  const kept = operations.flatMap(operation => {
    if (!isBuildingKnown(operation)) {
      report.push(`${nameOf(operation)}: left out, its building is gone`);
      return [];
    }
    const {filename, operation: kind, after} = operation;
    const isAddedAddress = filename === labelsFile && kind === 'add';
    const refreshedLabel = isAddedAddress ? labelByBuilding.get(after.properties.buildingEntityId) : undefined;
    if (!refreshedLabel) return [operation];
    report.push(`${nameOf(operation)}: kept the editor's address on the one the refresh brought`);
    const merged = addressOnRefreshedLabel(operation, refreshedLabel);
    return merged ? [merged] : [];
  });
  const handledKeys = new Set(
    kept.map(({filename, reference}) => `${filename}:${reference.localId ?? entityKey(reference)}`)
  );
  for (const filename of buildingPartFiles) {
    for (const [key, feature] of readSource(filename)) {
      const isStranded = deletedIds.has(buildingIdOf(filename, feature, sourceBuildings));
      if (!isStranded || handledKeys.has(`${filename}:${key}`)) continue;
      const operation = withoutBuilding(filename, key, feature);
      kept.push(operation);
      const outcome = filename === placesFile ? 'stands on its own' : 'goes too';
      report.push(`${nameOf(operation)}: its building was deleted in the editor, so it ${outcome}`);
    }
  }
  return {operations: kept, report};
}

// Returns the changeset that brings the current sources to what the ledger says, and a report for the reviewer.
export function replayChangeset(root, now, contractsDirectory) {
  const ledgerFile = path.join(root, ledgerPath);
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {corrections: []};
  const {groups, unfollowed} = correctionsByObject(ledger.corrections);
  const report = [...unfollowed];
  const bases = {};
  const sources = new Map();
  const readSource = filename => {
    if (!sources.has(filename)) {
      const bytes = fs.readFileSync(path.join(root, sourcesPath, filename));
      bases[filename] = sha256(bytes);
      const features = parseSource(filename, bytes).features;
      sources.set(filename, new Map(features.map(feature => [entityKey(feature.properties), feature])));
    }
    return sources.get(filename);
  };
  const buildings = JSON.parse(fs.readFileSync(path.join(root, sourcesPath, buildingsFile)));
  const replayedOperations = [];
  for (const [groupKey, corrections] of groups) {
    const {filename} = corrections[0];
    const key = groupKey.slice(filename.length + 1);
    const sourceFeature = readSource(filename).get(key) ?? null;
    const replayed = replayedObject(filename, corrections, sourceFeature);
    report.push(...replayed.report);
    const feature = restatedLabel(filename, replayed.feature, buildings);
    const operation = operationReaching(filename, key, sourceFeature, sourceFeature ? replayed.feature : feature);
    if (operation) replayedOperations.push(operation);
  }
  const rules = readContract(contractsDirectory, 'editor-layers.json');
  const levels = new Set(readContract(contractsDirectory, 'place-visibility.json').levels.map(({level}) => level));
  const allowed = allowedOperations(replayedOperations, {rules, levels});
  const {operations, report: buildingReport} = operationsKeepingBuildings(allowed.operations, readSource);
  report.push(...allowed.report, ...buildingReport);
  const changeset = {
    version: 2,
    id: 'replayed-corrections',
    createdAt: now,
    author: 'Corrections ledger',
    reason: 'Reviewed corrections kept over a data refresh',
    bases,
    operations
  };
  const sourceBuildings = [...readSource(buildingsFile).values()];
  const groupByOperation = new Map(
    operations.map(operation => [nameOf(operation), groupOf(operation, sourceBuildings)])
  );
  return {changeset, report, groupByOperation};
}

// The part of a changeset made of these operations, with the base hashes it needs.
function partOf(changeset, operations) {
  const filenames = new Set(operations.map(({filename}) => filename));
  const bases = Object.fromEntries(Object.entries(changeset.bases).filter(([filename]) => filenames.has(filename)));
  return {...changeset, bases, operations};
}

// Places the corrections of one group. Everything is replayed again, because placing a group can move the positions others
// are checked against. Returns the operations it tried and why they were refused, or null.
function applyGroup(group, root, options) {
  const {changeset, groupByOperation} = replayChangeset(root, options.now, options.contractsDirectory);
  const operations = changeset.operations.filter(operation => groupByOperation.get(nameOf(operation)) === group);
  if (operations.length === 0) return {operations, refusal: null};
  try {
    applyChangeset(partOf(changeset, operations), root, options);
    return {operations, refusal: null};
  } catch (error) {
    if (error.hasUnrestoredFiles) throw error;
    return {operations, refusal: error.message};
  }
}

// Places one group after another, so that one the final check refuses stops no other. A group can wait for another, such
// as a deleted road for its turn rules, so the refused ones are tried again for as long as any other is placed.
function applyByGroups(root, options) {
  const {groupByOperation} = replayChangeset(root, options.now, options.contractsDirectory);
  let waiting = [...new Set(groupByOperation.values())];
  let refused = [];
  let placedCount = 0;
  let hasProgress = true;
  while (hasProgress) {
    refused = [];
    for (const group of waiting) {
      const {operations, refusal} = applyGroup(group, root, options);
      if (refusal === null) placedCount += operations.length;
      else refused.push({group, operations, refusal});
    }
    hasProgress = refused.length > 0 && refused.length < waiting.length;
    waiting = refused.map(({group}) => group);
  }
  const report = refused.flatMap(({operations, refusal}) =>
    operations.map(operation => `${nameOf(operation)}: not placed, ${refusal}`)
  );
  return {operations: placedCount, report};
}

// Applies the ledger and returns what changed and what needs a reviewer. The ledger itself is not changed.
export function reapplyCorrections(root, {now = new Date().toISOString(), contractsDirectory, ...options} = {}) {
  const {changeset, report} = replayChangeset(root, now, contractsDirectory);
  if (changeset.operations.length === 0) return {operations: 0, report};
  const applyOptions = {now, contractsDirectory, ...options, recordsCorrections: false};
  try {
    applyChangeset(partOf(changeset, changeset.operations), root, applyOptions);
    return {operations: changeset.operations.length, report};
  } catch (error) {
    // Groups are only tried over sources that are as they were.
    if (error.hasUnrestoredFiles) throw error;
    const placed = applyByGroups(root, applyOptions);
    const reason = `Not everything fits at once, so the corrections were placed one by one: ${error.message}`;
    return {operations: placed.operations, report: [...report, reason, ...placed.report]};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contractsDirectory = contractsDirectoryFrom(process.argv.slice(2), 'reapply-corrections.mjs');
  const {operations, report} = reapplyCorrections(rootDirectory, {contractsDirectory});
  for (const line of report) console.log(line);
  console.log(`Replayed ${operations} corrections; ${report.length} need a look. Review the diff before committing.`);
}
