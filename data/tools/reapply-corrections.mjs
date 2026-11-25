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

const nameOf = ({filename, reference}) => `${filename} ${reference.entityId ?? reference.localId}`;

// Corrections that came together, or that touch one object, are placed or refused together. Returns a function that
// names the group of a correction.
function correctionGroups(corrections) {
  const parents = new Map();
  const rootOf = name => {
    let root = name;
    while (parents.has(root)) root = parents.get(root);
    return root;
  };
  for (const objectCorrections of corrections.values()) {
    const [firstRoot, ...otherRoots] = objectCorrections.map(({changeset}) => rootOf(changeset));
    for (const otherRoot of otherRoots) {
      const isJoined = rootOf(otherRoot) === rootOf(firstRoot);
      if (!isJoined) parents.set(rootOf(otherRoot), rootOf(firstRoot));
    }
  }
  return correction => rootOf(correction.changeset);
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

// Buildings that have an address in the refreshed sources which no correction deletes.
function addressedBuildingIds(operations, readSource, sourceBuildings) {
  const deletedNames = new Set(operations.filter(({operation}) => operation === 'delete').map(nameOf));
  const labels = [...readSource(labelsFile).values()].filter(
    ({properties}) => !deletedNames.has(`${labelsFile} ${properties.entityId}`)
  );
  return new Set(labels.map(label => buildingIdOf(labelsFile, label, sourceBuildings)));
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
  // Which building operation each added operation follows from.
  const causes = new Map();
  const addressedIds = addressedBuildingIds(operations, readSource, sourceBuildings);
  const isBuildingKnown = ({filename, after}) => {
    if (!after || !buildingPartFiles.includes(filename)) return true;
    const buildingId = buildingIdOf(filename, after, sourceBuildings);
    return buildingId === undefined || (knownIds.has(buildingId) && !deletedIds.has(buildingId));
  };
  const kept = operations.filter(operation => {
    const {filename, operation: kind, after} = operation;
    const isSecondAddress = filename === labelsFile && kind === 'add' && addressedIds.has(after.properties.buildingEntityId);
    if (isBuildingKnown(operation) && !isSecondAddress) return true;
    const reason = isSecondAddress ? 'the refreshed sources have an address of this building' : 'its building is gone';
    report.push(`${nameOf(operation)}: left out, ${reason}`);
    return false;
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
      causes.set(nameOf(operation), `${buildingsFile} ${buildingIdOf(filename, feature, sourceBuildings)}`);
      const outcome = filename === placesFile ? 'stands on its own' : 'goes too';
      report.push(`${nameOf(operation)}: its building was deleted in the editor, so it ${outcome}`);
    }
  }
  return {operations: kept, report, causes};
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
  const groupOf = correctionGroups(groups);
  const replayedOperations = [];
  const groupByOperation = new Map();
  for (const [groupKey, corrections] of groups) {
    const {filename} = corrections[0];
    const key = groupKey.slice(filename.length + 1);
    const sourceFeature = readSource(filename).get(key) ?? null;
    const replayed = replayedObject(filename, corrections, sourceFeature);
    report.push(...replayed.report);
    const feature = restatedLabel(filename, replayed.feature, buildings);
    const operation = operationReaching(filename, key, sourceFeature, sourceFeature ? replayed.feature : feature);
    if (!operation) continue;
    replayedOperations.push(operation);
    groupByOperation.set(nameOf(operation), groupOf(corrections[0]));
  }
  const rules = readContract(contractsDirectory, 'editor-layers.json');
  const levels = new Set(readContract(contractsDirectory, 'place-visibility.json').levels.map(({level}) => level));
  const allowed = allowedOperations(replayedOperations, {rules, levels});
  const {operations, report: buildingReport, causes} = operationsKeepingBuildings(allowed.operations, readSource);
  for (const [name, causeName] of causes) groupByOperation.set(name, groupByOperation.get(causeName));
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
  return {changeset, report, groupByOperation};
}

// The part of a changeset made of these operations, with the base hashes it needs.
function partOf(changeset, operations) {
  const filenames = new Set(operations.map(({filename}) => filename));
  const bases = Object.fromEntries(Object.entries(changeset.bases).filter(([filename]) => filenames.has(filename)));
  return {...changeset, bases, operations};
}

// Places the corrections of one group after another, so that one the final check refuses stops no other. Everything is
// replayed again for each group, because placing one can move the positions others are checked against.
function applyByGroups(root, now, options) {
  const {groupByOperation} = replayChangeset(root, now, options.contractsDirectory);
  const report = [];
  let placedCount = 0;
  for (const group of new Set(groupByOperation.values())) {
    const replayed = replayChangeset(root, now, options.contractsDirectory);
    const operations = replayed.changeset.operations.filter(
      operation => replayed.groupByOperation.get(nameOf(operation)) === group
    );
    if (operations.length === 0) continue;
    try {
      applyChangeset(partOf(replayed.changeset, operations), root, options);
      placedCount += operations.length;
    } catch (error) {
      report.push(...operations.map(operation => `${nameOf(operation)}: not placed, ${error.message}`));
    }
  }
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
  } catch {
    // Nothing was written. Each group tells its own reason.
    const placed = applyByGroups(root, now, applyOptions);
    return {operations: placed.operations, report: [...report, ...placed.report]};
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contractsDirectory = contractsDirectoryFrom(process.argv.slice(2), 'reapply-corrections.mjs');
  const {operations, report} = reapplyCorrections(rootDirectory, {contractsDirectory});
  for (const line of report) console.log(line);
  console.log(`Replayed ${operations} corrections; ${report.length} need a look. Review the diff before committing.`);
}
