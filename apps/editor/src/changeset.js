import {fieldItemProblem} from './field-items.js';
import {featureFingerprint} from './hashing.js';
import {operationProblem} from './layer-rules.js';

const changesetVersion = 2;
const readableVersions = [1, 2];
const entityKey = ({entityId, entityPart}) => `${entityId}#${entityPart ?? ''}`;

// An object with source identity is named by it, so the change still applies after others of its file changed. Objects
// without one, such as a route, keep their position in this snapshot.
function exportedReference(reference, before) {
  const {entityId, entityPart} = before?.properties ?? {};
  if (entityId === undefined) return reference;
  return entityPart === undefined ? {entityId} : {entityId, entityPart};
}

// Builds the reviewable export described by the editor-changeset schema.
export async function buildChangeset(session, sources, {id, createdAt, author, reason}) {
  const bases = {};
  const operations = [];
  for (const filename of session.changedFiles()) {
    bases[filename] = sources.get(filename).metadata.sha256;
    for (const {operation, reference, before, after} of session.changes(filename)) {
      const beforeFingerprint = before ? await featureFingerprint(before) : null;
      const exported = exportedReference(reference, before);
      operations.push({filename, operation, reference: exported, beforeFingerprint, before, after});
    }
  }
  const fieldItems = session.fieldItems();
  const changeset = {version: changesetVersion, id, createdAt, author, reason, bases, operations};
  return fieldItems.length > 0 ? {...changeset, fieldItems} : changeset;
}

// A plain GeoJSON view of one changed file for GIS inspection. It never replaces a source file.
export function materializedLayer(session, filename) {
  const features = session.workingEntries(filename).map(({feature}) => feature);
  return {type: 'FeatureCollection', features};
}

function requireImportable(condition, message) {
  if (!condition) throw new Error(`Import refused: ${message}`);
}

// Position of every object of a file by its source identity, built once per imported file.
function indexByEntityKey(source) {
  return new Map(source.collection.features.map(({properties}, index) => [entityKey(properties), index]));
}

// The session key of the object an operation names, or null when this snapshot does not have it.
function sessionKey({reference}, entityIndex) {
  if (reference?.localId !== undefined) return reference.localId;
  const index = reference?.entityId === undefined ? reference?.featureIndex : entityIndex.get(entityKey(reference));
  return index === undefined ? null : String(index);
}

// A revision-bound reference means nothing unless the feature is still exactly what the changeset recorded.
async function checkAgainstSnapshot({filename, reference, before, beforeFingerprint}, key, source) {
  const name = reference.entityId ?? `feature ${reference.featureIndex}`;
  const current = source.collection.features[key];
  requireImportable(current, `${filename}: ${name} does not exist in this snapshot`);
  const isSameFeature = JSON.stringify(current) === JSON.stringify(before);
  const isSameFingerprint = (await featureFingerprint(current)) === beforeFingerprint;
  requireImportable(isSameFeature && isSameFingerprint, `${filename}: ${name} has changed`);
}

async function checkOperation(operation, key, sources, rules, levels) {
  const {filename, operation: operationKind, reference} = operation;
  requireImportable(rules.layers[filename], `unknown source file ${filename}`);
  if (operationKind !== 'add') await checkAgainstSnapshot(operation, key, sources.get(filename));
  const problem = operationProblem(operation, rules, levels);
  requireImportable(!problem, `${filename} ${JSON.stringify(reference)}: ${problem}`);
}

// Resumes a reviewed changeset on this snapshot, with the same checks as the importer. Everything is checked before the
// first edit is recorded, so a refused file leaves the session untouched.
export async function importChangeset(changeset, session, sources, rules, levels) {
  requireImportable(readableVersions.includes(changeset?.version), 'unsupported changeset version');
  const {operations, bases} = changeset;
  const fieldItems = changeset.fieldItems ?? [];
  const hasContent = Array.isArray(operations) && operations.length + fieldItems.length > 0;
  requireImportable(hasContent, 'no operations');
  requireImportable(!session.hasChanges(), 'export or discard the current changes first');
  const boundFiles = new Set(
    operations
      .filter(({reference}) => changeset.version === 1 || reference?.featureIndex !== undefined)
      .map(({filename}) => filename)
  );
  for (const [filename, base] of Object.entries(bases ?? {})) {
    const isSameRevision = sources.get(filename)?.metadata.sha256 === base;
    requireImportable(isSameRevision || !boundFiles.has(filename), `${filename} differs from this snapshot`);
  }
  const entityIndexByFile = new Map();
  for (const {filename} of operations) {
    requireImportable(bases?.[filename], `${filename} has no base hash`);
    requireImportable(sources.has(filename), `unknown source file ${filename}`);
    if (!entityIndexByFile.has(filename)) entityIndexByFile.set(filename, indexByEntityKey(sources.get(filename)));
  }
  const keys = operations.map(operation => sessionKey(operation, entityIndexByFile.get(operation.filename)));
  const targets = operations.map(({filename}, index) => `${filename}:${keys[index]}`);
  requireImportable(new Set(targets).size === targets.length, 'two operations target the same feature');
  for (const [index, operation] of operations.entries()) {
    await checkOperation(operation, keys[index], sources, rules, levels);
  }
  for (const item of fieldItems) {
    const problem = fieldItemProblem(item, [...sources.keys()]);
    requireImportable(!problem, problem);
  }
  operations.forEach(({filename, after}, index) => session.recordEdit(filename, keys[index], after));
  fieldItems.forEach(item => session.saveFieldItem(item));
}
