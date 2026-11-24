// Replays the corrections ledger over freshly extracted sources, so an OpenStreetMap refresh never overrides a reviewed
// edit. An edit touches only what it changed: every other fact of the object keeps its refreshed value. What cannot be
// placed is reported, never dropped silently. See docs/runbooks/data.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyChangeset} from './apply-changeset.mjs';
import {entityKey, isLocalId} from './changeset-derivations.mjs';
import {parseSource} from './changeset-sources.mjs';
import {contractsDirectoryFrom} from './contracts.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcesPath = 'data/sources';
const ledgerPath = `${sourcesPath}/editor-corrections.json`;
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
  const isAddedLabel = filename === 'building-labels.geojson' && feature && isLocalId(feature.id);
  if (!isAddedLabel) return feature;
  const restated = structuredClone(feature);
  const {properties} = restated;
  properties.buildingEntityId ??= buildings.features[properties.footprintIndex]?.properties.entityId;
  for (const name of ['footprintIndex', 'osm_id', 'address_sources']) delete properties[name];
  delete restated.id;
  return restated;
}

// Returns the changeset that brings the current sources to what the ledger says, and a report for the reviewer.
export function replayChangeset(root, now) {
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
  const buildings = JSON.parse(fs.readFileSync(path.join(root, sourcesPath, 'buildings.geojson')));
  const operations = [];
  for (const [groupKey, corrections] of groups) {
    const {filename} = corrections[0];
    const key = groupKey.slice(filename.length + 1);
    const sourceFeature = readSource(filename).get(key) ?? null;
    const replayed = replayedObject(filename, corrections, sourceFeature);
    report.push(...replayed.report);
    const feature = restatedLabel(filename, replayed.feature, buildings);
    const operation = operationReaching(filename, key, sourceFeature, sourceFeature ? replayed.feature : feature);
    if (operation) operations.push(operation);
  }
  const usedFiles = new Set(operations.map(({filename}) => filename));
  const usedBases = Object.fromEntries(Object.entries(bases).filter(([filename]) => usedFiles.has(filename)));
  const changeset = {
    version: 2,
    id: 'replayed-corrections',
    createdAt: now,
    author: 'Corrections ledger',
    reason: 'Reviewed corrections kept over a data refresh',
    bases: usedBases,
    operations
  };
  return {changeset, report};
}

// Applies the ledger and returns what changed and what needs a reviewer. The ledger itself is not changed.
export function reapplyCorrections(root, {now = new Date().toISOString(), contractsDirectory, ...options} = {}) {
  const {changeset, report} = replayChangeset(root, now);
  if (changeset.operations.length === 0) return {operations: 0, report};
  applyChangeset(changeset, root, {now, contractsDirectory, ...options, recordsCorrections: false});
  return {operations: changeset.operations.length, report};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const contractsDirectory = contractsDirectoryFrom(process.argv.slice(2), 'reapply-corrections.mjs');
  const {operations, report} = reapplyCorrections(rootDirectory, {contractsDirectory});
  for (const line of report) console.log(line);
  console.log(`Replayed ${operations} corrections; ${report.length} need a look. Review the diff before committing.`);
}
