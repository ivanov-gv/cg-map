import {featureFingerprint} from './hashing.js';
import {operationProblem} from './layer-rules.js';

// Builds the reviewable export described by packages/contracts/editor-changeset.schema.json.
export async function buildChangeset(session, sources, {id, createdAt, author, reason}) {
  const bases = {};
  const operations = [];
  for (const filename of session.changedFiles()) {
    bases[filename] = sources.get(filename).metadata.sha256;
    for (const {operation, reference, before, after} of session.changes(filename)) {
      const beforeFingerprint = before ? await featureFingerprint(before) : null;
      operations.push({filename, operation, reference, beforeFingerprint, before, after});
    }
  }
  return {version: 1, id, createdAt, author, reason, bases, operations};
}

// A plain GeoJSON view of one changed file for GIS inspection. It never replaces a source file.
export function materializedLayer(session, filename) {
  const features = session.workingEntries(filename).map(({feature}) => feature);
  return {type: 'FeatureCollection', features};
}

function requireImportable(condition, message) {
  if (!condition) throw new Error(`Import refused: ${message}`);
}

const operationKey = ({filename, reference}) => `${filename}:${reference?.localId ?? reference?.featureIndex}`;

// A revision-bound reference means nothing unless the feature is still exactly what the changeset recorded.
async function checkAgainstSnapshot({filename, reference, before, beforeFingerprint}, source) {
  const current = source.collection.features[reference.featureIndex];
  requireImportable(current, `${filename}: feature ${reference.featureIndex} does not exist in this snapshot`);
  const isSameFeature = JSON.stringify(current) === JSON.stringify(before);
  const isSameFingerprint = (await featureFingerprint(current)) === beforeFingerprint;
  requireImportable(isSameFeature && isSameFingerprint, `${filename}: feature ${reference.featureIndex} has changed`);
}

async function checkOperation(operation, sources, rules, levels) {
  const {filename, operation: operationKind, reference} = operation;
  requireImportable(rules.layers[filename], `unknown source file ${filename}`);
  if (operationKind !== 'add') await checkAgainstSnapshot(operation, sources.get(filename));
  const problem = operationProblem(operation, rules, levels);
  requireImportable(!problem, `${filename} ${JSON.stringify(reference)}: ${problem}`);
}

// Resumes a reviewed changeset on this snapshot, with the same checks as the importer. Everything is checked before the
// first edit is recorded, so a refused file leaves the session untouched.
export async function importChangeset(changeset, session, sources, rules, levels) {
  requireImportable(changeset?.version === 1, 'unsupported changeset version');
  const {operations, bases} = changeset;
  requireImportable(Array.isArray(operations) && operations.length > 0, 'no operations');
  requireImportable(session.changedFiles().length === 0, 'export or discard the current changes first');
  for (const [filename, base] of Object.entries(bases ?? {})) {
    requireImportable(sources.get(filename)?.metadata.sha256 === base, `${filename} differs from this snapshot`);
  }
  const keys = operations.map(operationKey);
  requireImportable(new Set(keys).size === keys.length, 'two operations target the same feature');
  for (const operation of operations) {
    requireImportable(bases?.[operation.filename], `${operation.filename} has no base hash`);
    await checkOperation(operation, sources, rules, levels);
  }
  for (const {filename, reference, after} of operations) {
    session.recordEdit(filename, reference.localId ?? String(reference.featureIndex), after);
  }
}
