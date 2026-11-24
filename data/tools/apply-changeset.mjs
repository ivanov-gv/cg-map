// Applies a reviewed editor changeset to data/sources. Everything is validated before the first write, writes are
// staged, and a failed final check restores the reviewed files. See docs/runbooks/data.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyVisibility, placesProvenance, resolveLevel, serializePlaces} from './apply-place-visibility.mjs';
import {entityKey, isLocalId, labelsFollowingBuildings, labelsWithBearings, withDerivedFacts} from './changeset-derivations.mjs';
import {checkOperationRules, requireSupportedRules, requireThat} from './changeset-rules.mjs';
import {isRecordFile, parseSource, serializeSource} from './changeset-sources.mjs';
import {checkData, validateBuildingLabels, validateBuildingSources, validateCollection} from './check-data.mjs';
import {contractPath, contractsDirectoryFrom, readContract} from './contracts.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcesPath = 'data/sources';
const policyPath = 'data/sources/place-visibility-policy.json';
const provenancePath = 'data/sources/provenance.json';
const labelProvenancePath = 'data/sources/building-labels.provenance.json';
const ledgerPath = 'data/sources/editor-corrections.json';
const buildingsFile = 'buildings.geojson';
const labelsFile = 'building-labels.geojson';
const placesFile = 'places.geojson';
const localEntityIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Their own provenance files, beside the one for the extracted layers.
const ownProvenance = new Map([
  ['transport-stops.geojson', {path: 'data/sources/transport-stops.provenance.json', countField: 'features'}],
  ['transit-routes.json', {path: 'data/sources/transit-routes.provenance.json', countField: 'routes'}]
]);

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = feature => sha256(JSON.stringify(feature));
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

// Adopted collections and the record files carry source identity on every object. Routes are the exception: their
// identity is on each direction.
function carriesIdentity(filename, source) {
  return filename !== 'transit-routes.json' && source.entitySchemaVersion === 1;
}

// Version 2 keeps the local ID an object had in the editor, so other objects can refer to it before the import.
// Version 1 places had their own random identity.
function localEntityId(changeset, operation, newEntityId) {
  return changeset.version === 1 ? newEntityId(operation.after) : operation.reference.localId;
}

// An adopted file requires identity on every feature, so the importer writes it on additions. The version is a
// content hash of the reviewed export: it is a base token, not a claim about an upstream object.
function adoptAddedFeature(feature, entityId, usedIds) {
  requireThat(localEntityIdPattern.test(entityId), `invalid local entity ID ${entityId}`);
  requireThat(!usedIds.has(entityId), `duplicate local entity ID ${entityId}`);
  usedIds.add(entityId);
  return {
    ...feature,
    properties: {
      ...feature.properties,
      entityId,
      entityVersion: `sha256:${sha256(JSON.stringify(feature))}`
    }
  };
}

// Position of the object an operation names, in this snapshot. Refuses a name that matches nothing.
function referencedIndex({filename, reference}, source, indexByKey) {
  if (reference.entityId === undefined) return reference.featureIndex;
  const index = indexByKey.get(entityKey(reference));
  requireThat(index !== undefined, `${filename}: ${reference.entityId} does not exist in the current sources`);
  return index;
}

function checkExistingFeature(operation, index, source) {
  const {filename, reference} = operation;
  const current = source.features[index];
  const name = reference.entityId ?? `feature ${index}`;
  requireThat(current, `${filename}: ${name} does not exist in this snapshot`);
  const isReviewed = fingerprint(current) === operation.beforeFingerprint;
  requireThat(isReviewed, `${filename}: ${name} differs from the reviewed fingerprint`);
  requireThat(
    isSameJSON(current, operation.before),
    `${filename}: ${name} differs from its recorded before state`
  );
}

function checkEnvelope(changeset) {
  requireThat([1, 2].includes(changeset?.version), 'unsupported version');
  for (const field of ['id', 'author', 'reason']) {
    requireThat(typeof changeset[field] === 'string' && changeset[field].trim().length > 0, `${field} is required`);
  }
  requireThat(Number.isFinite(Date.parse(changeset.createdAt)), 'createdAt is not a date');
  requireThat(Array.isArray(changeset.operations) && changeset.operations.length > 0, 'no operations');
  const references = changeset.operations.map(({filename, reference}) => `${filename}:${JSON.stringify(reference)}`);
  requireThat(new Set(references).size === references.length, 'two operations target the same feature');
  for (const {filename, reference} of changeset.operations) {
    requireThat(Object.hasOwn(changeset.bases ?? {}, filename), `${filename} has no base hash`);
    const isSupported = changeset.version === 2 || reference?.entityId === undefined;
    requireThat(isSupported, 'references by entity ID need version 2');
  }
}

// Reads each changed source. A feature index means nothing on another revision, so it stops there; an entity ID still
// names the same object.
function readPinnedSources(changeset, root) {
  const sources = new Map();
  for (const [filename, expectedHash] of Object.entries(changeset.bases)) {
    requireThat(/^[a-z][a-z-]*\.(geojson|json)$/.test(filename), `unsafe source file ${filename}`);
    const bytes = fs.readFileSync(path.join(root, sourcesPath, filename));
    const isBoundToRevision = changeset.operations.some(
      operation => operation.filename === filename && operation.reference?.featureIndex !== undefined
    );
    const isSameRevision = sha256(bytes) === expectedHash;
    requireThat(
      isSameRevision || (changeset.version === 2 && !isBoundToRevision),
      `${filename} differs from the base of this changeset`
    );
    sources.set(filename, parseSource(filename, bytes));
  }
  return sources;
}

// Resolves every reference to a position and checks the object there is still the reviewed one.
function resolvedOperations(changeset, sources, rules, levels) {
  const indexByFile = new Map(
    [...sources].map(([filename, source]) => [
      filename,
      new Map(source.features.map(({properties}, index) => [entityKey(properties), index]))
    ])
  );
  const resolved = changeset.operations.map(operation => {
    requireThat(rules.layers[operation.filename], `unknown source file ${operation.filename}`);
    checkOperationRules(operation, rules, levels);
    if (operation.operation === 'add') return operation;
    const source = sources.get(operation.filename);
    const index = referencedIndex(operation, source, indexByFile.get(operation.filename));
    checkExistingFeature(operation, index, source);
    return {...operation, index};
  });
  const targets = resolved
    .filter(({index}) => index !== undefined)
    .map(({filename, index}) => `${filename}:${index}`);
  requireThat(new Set(targets).size === targets.length, 'two operations target the same feature');
  return resolved;
}

// Existing features keep their index until deletions are applied last, so references stay valid while applying.
function applyOperations(source, operations) {
  const features = [...source.features];
  const added = [];
  for (const operation of operations) {
    if (operation.operation === 'add') added.push(operation.after);
    else features[operation.index] = operation.after;
  }
  return {...source, features: [...features.filter(Boolean), ...added]};
}

// A commercial record is a separate review, so a correction never replaces or removes it by accident.
function requireNotCommercial(id, override) {
  requireThat(
    override?.provenance?.basis !== 'commercial',
    `${id} has a commercial placement; review it in the policy`
  );
}

function overrideFor(id, level, changeset, previous) {
  requireNotCommercial(id, previous);
  return {
    ...previous,
    id,
    level,
    reason: changeset.reason,
    active: true,
    provenance: {basis: 'editorial', reviewedBy: changeset.author, reviewedAt: changeset.createdAt}
  };
}

// A level is generated from the policy, so a level the policy would not produce must become an override, or the next
// regeneration loses it. A level the policy already produces changes nothing, which keeps an existing override's
// reason and reviewer when someone only renames a place.
function policyWithLevelEdits(policy, operations, changeset) {
  const overrides = new Map(policy.overrides.map(override => [override.id, override]));
  const deletedIds = operations.filter(({operation}) => operation === 'delete').map(({before}) => before.properties.id);
  for (const id of deletedIds) {
    requireNotCommercial(id, overrides.get(id));
    overrides.delete(id);
  }
  for (const {after} of operations.filter(({after}) => after)) {
    const {id, visibilityLevel} = after.properties;
    const activeLevels = new Map(
      [...overrides.values()].filter(({active}) => active).map(override => [override.id, override.level])
    );
    if (resolveLevel(after.properties, policy, activeLevels) === visibilityLevel) continue;
    const ruleLevel = resolveLevel(after.properties, policy);
    if (visibilityLevel === ruleLevel) overrides.delete(id);
    else overrides.set(id, overrideFor(id, visibilityLevel, changeset, overrides.get(id)));
  }
  return {...policy, overrides: [...overrides.values()]};
}

// Keeps the values as well as the hashes: this ledger is what tells a local correction from an imported upstream fact.
function ledgerEntries(changeset, appliedAt) {
  return changeset.operations.map(({filename, operation, reference, beforeFingerprint, before, after}) => ({
    changeset: changeset.id,
    appliedAt,
    author: changeset.author,
    reason: changeset.reason,
    filename,
    operation,
    reference,
    beforeFingerprint,
    afterFingerprint: after ? fingerprint(after) : null,
    before,
    after
  }));
}

function readLedger(root) {
  const file = path.join(root, ledgerPath);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {version: 1, corrections: []};
}

const featureCount = (filename, bytes) => parseSource(filename, bytes).features.length;

// Extracted labels are counted by how their address was found; those added in the editor are counted apart.
function labelCounts(labels) {
  const local = labels.features.filter(({id}) => isLocalId(id)).length;
  const direct = labels.features.filter(({id, properties}) => !isLocalId(id) && properties.address_sources.includes(id));
  return {
    features: labels.features.length,
    direct_building_addresses: direct.length,
    node_derived_addresses: labels.features.length - direct.length - local,
    local_addresses: local
  };
}

function nextLabelProvenance(provenance, labelBytes, buildingBytes) {
  const {local_addresses: localAddresses, ...counts} = labelCounts(JSON.parse(labelBytes));
  return {
    ...provenance,
    ...counts,
    ...(localAddresses > 0 ? {local_addresses: localAddresses} : {}),
    bytes: Buffer.byteLength(labelBytes),
    sha256: sha256(labelBytes),
    buildings_sha256: sha256(buildingBytes)
  };
}

function nextBuildingDetails(details, bytesOf, contractsDirectory) {
  const [buildings, roads, entrances, places] = [
    buildingsFile,
    'roads.geojson',
    'building-entrances.geojson',
    placesFile
  ].map(filename => JSON.parse(bytesOf(filename)));
  const counts = validateBuildingSources(buildings, roads, entrances, places, {contractsDirectory});
  return {...details, ...counts};
}

function ownProvenanceWrites(root, nextBytes) {
  return [...ownProvenance]
    .filter(([filename]) => nextBytes.has(filename))
    .map(([filename, {path: provenanceFile, countField}]) => {
      const bytes = nextBytes.get(filename);
      const provenance = {
        ...JSON.parse(fs.readFileSync(path.join(root, provenanceFile), 'utf8')),
        [countField]: featureCount(filename, bytes),
        bytes: Buffer.byteLength(bytes),
        sha256: sha256(bytes)
      };
      return [provenanceFile, JSON.stringify(provenance, null, 2) + '\n'];
    });
}

function provenanceWrites(root, nextBytes, policyBytes, places, {visibilityConfigBytes, contractsDirectory}) {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const provenance = JSON.parse(read(provenancePath));
  const labelProvenance = JSON.parse(read(labelProvenancePath));
  const bytesOf = filename => nextBytes.get(filename) ?? read(`${sourcesPath}/${filename}`);
  for (const name of Object.keys(provenance.layers)) {
    const bytes = bytesOf(name);
    provenance.layers[name] = {
      ...provenance.layers[name],
      features: featureCount(name, bytes),
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes)
    };
  }
  provenance.building_details = nextBuildingDetails(provenance.building_details, bytesOf, contractsDirectory);
  if (places) {
    const placeBytes = nextBytes.get(placesFile);
    Object.assign(provenance, placesProvenance(placeBytes, places, policyBytes, visibilityConfigBytes), {
      places_count: places.features.length
    });
  }
  const nextLabels = nextLabelProvenance(labelProvenance, bytesOf(labelsFile), bytesOf(buildingsFile));
  return [
    [provenancePath, JSON.stringify(provenance, null, 2) + '\n'],
    [labelProvenancePath, JSON.stringify(nextLabels, null, 2) + '\n'],
    ...ownProvenanceWrites(root, nextBytes)
  ];
}

// Through a staged file and a rename, like the forward path: a plain write truncates first, so running out of disk in the
// middle of a restore would destroy the file. If this throws, the file still has its previous content.
function restoreFile(file, bytes) {
  if (!bytes) {
    fs.rmSync(file, {force: true});
    return;
  }
  const restoringPath = `${file}.restoring-${process.pid}`;
  try {
    fs.writeFileSync(restoringPath, bytes);
    fs.renameSync(restoringPath, file);
  } finally {
    fs.rmSync(restoringPath, {force: true});
  }
}

// Keeps going past a failure, because every other file still needs restoring. Returns a sentence naming what failed.
function restoreOriginals(originals) {
  const unrestoredFiles = [];
  for (const [file, bytes] of originals) {
    try {
      restoreFile(file, bytes);
    } catch {
      unrestoredFiles.push(file);
    }
  }
  return unrestoredFiles.length > 0 ? ` Could not restore: ${unrestoredFiles.join(', ')}.` : '';
}

// Every target's bytes are written beside it first, so a failed write touches no reviewed file, which matters most on a
// full disk. A failed rename restores only the files already replaced. Returns a function that restores them all and
// reports what it could not.
function writeStaged(root, writes) {
  const stagedPath = relative => `${path.join(root, relative)}.staged-${process.pid}`;
  const originals = writes.map(([relative]) => {
    const file = path.join(root, relative);
    return [file, fs.existsSync(file) ? fs.readFileSync(file) : null];
  });
  let replacedCount = 0;
  try {
    for (const [relative, bytes] of writes) fs.writeFileSync(stagedPath(relative), bytes);
    for (const [relative] of writes) {
      fs.renameSync(stagedPath(relative), path.join(root, relative));
      replacedCount += 1;
    }
  } catch (error) {
    const restoreNote = restoreOriginals(originals.slice(0, replacedCount));
    throw new Error(`Changeset not applied: ${error.message}.${restoreNote}`, {cause: error});
  } finally {
    for (const [relative] of writes) fs.rmSync(stagedPath(relative), {force: true});
  }
  return () => restoreOriginals(originals);
}

function checkChangedCollection(filename, collection, contractsDirectory) {
  if (isRecordFile(filename)) return;
  validateCollection(collection, {
    label: filename,
    requireKind: filename !== 'transport-stops.geojson',
    contractsDirectory
  });
}

// Every changed file after the edits and the derived facts that follow from them.
function nextCollections(changeset, sources, operations, read) {
  const edited = new Map();
  const changedKeysByFile = new Map();
  for (const [filename, source] of sources) {
    const fileOperations = operations.filter(operation => operation.filename === filename);
    edited.set(filename, applyOperations(source, fileOperations));
    const changedKeys = fileOperations.filter(({after}) => after).map(({after}) => entityKey(after.properties));
    changedKeysByFile.set(filename, new Set(changedKeys));
  }
  const next = withDerivedFacts(edited, sources, changedKeysByFile, read);
  if (!next.has(buildingsFile) && !next.has(labelsFile)) return next;
  // Positions are those of the written file, which is sorted.
  const buildings = next.has(buildingsFile)
    ? parseSource(buildingsFile, serializeSource(buildingsFile, next.get(buildingsFile)))
    : read(buildingsFile);
  const labels = labelsFollowingBuildings(next.get(labelsFile) ?? read(labelsFile), read(buildingsFile), buildings);
  const changedBuildingKeys = changedKeysByFile.get(buildingsFile) ?? new Set();
  next.set(labelsFile, labelsWithBearings(labels, read(labelsFile), buildings, changedBuildingKeys));
  return next;
}

// The new bytes of every changed source, plus the policy and regenerated places when places changed.
function serializedResults(collections, changeset, operations, policyText, levelConfig, contractsDirectory) {
  const nextBytes = new Map();
  let policyBytes = policyText;
  let places = null;
  for (const [filename, collection] of collections) {
    if (filename !== placesFile) {
      checkChangedCollection(filename, collection, contractsDirectory);
      nextBytes.set(filename, serializeSource(filename, collection));
      continue;
    }
    const placeOperations = operations.filter(operation => operation.filename === filename);
    const policy = policyWithLevelEdits(JSON.parse(policyText), placeOperations, changeset);
    policyBytes = JSON.stringify(policy, null, 2) + '\n';
    places = applyVisibility(collection, policy, levelConfig);
    validateCollection(places, {places: true, label: 'places', contractsDirectory});
    nextBytes.set(filename, serializePlaces(places));
  }
  return {nextBytes, policyBytes, places};
}

function withLocalIdentity(changeset, operations, sources, newEntityId) {
  const usedIds = new Set(
    [...sources.values()].flatMap(source => source.features.map(({properties}) => properties.entityId).filter(Boolean))
  );
  return operations.map(operation => {
    const isAdoptedAddition =
      operation.operation === 'add' && carriesIdentity(operation.filename, sources.get(operation.filename));
    if (!isAdoptedAddition) return operation;
    const entityId = localEntityId(changeset, operation, newEntityId);
    return {...operation, after: adoptAddedFeature(operation.after, entityId, usedIds)};
  });
}

function writeChecked(root, writes, checkFinalData, contractsDirectory) {
  const restore = writeStaged(root, writes);
  try {
    checkFinalData(root, {contractsDirectory});
  } catch (error) {
    const restoreNote = restore();
    const outcome = restoreNote ? 'reviewed files not fully restored' : 'reviewed files restored';
    throw new Error(`Changeset refused, ${outcome}: ${error.message}.${restoreNote}`, {cause: error});
  }
}

const tileRebuildExceptions = new Set([placesFile, labelsFile, 'transport-stops.geojson', 'transit-routes.json']);

// Returns a summary. Throws before writing when anything fails validation, leaving reviewed inputs intact, and restores
// them if the final check on the written files fails. checkFinalData exists so a test can fail that last step.
// recordsCorrections is off while replaying the ledger, whose entries are already recorded.
export function applyChangeset(
  changeset,
  root = rootDirectory,
  {
    now = new Date().toISOString(),
    checkFinalData = checkData,
    contractsDirectory,
    newEntityId = () => `local:${crypto.randomUUID()}`,
    recordsCorrections = true
  } = {}
) {
  checkEnvelope(changeset);
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const readSource = filename => parseSource(filename, read(`${sourcesPath}/${filename}`));
  const rules = readContract(contractsDirectory, 'editor-layers.json');
  requireSupportedRules(rules);
  const visibilityConfigBytes = fs.readFileSync(contractPath(contractsDirectory, 'place-visibility.json'), 'utf8');
  const levelConfig = JSON.parse(visibilityConfigBytes);
  const levels = new Set(levelConfig.levels.map(entry => entry.level));
  const sources = readPinnedSources(changeset, root);
  const resolved = resolvedOperations(changeset, sources, rules, levels);
  const operations = withLocalIdentity(changeset, resolved, sources, newEntityId);
  const collections = nextCollections(changeset, sources, operations, readSource);
  const {nextBytes, policyBytes, places} = serializedResults(
    collections,
    changeset,
    operations,
    read(policyPath),
    levelConfig,
    contractsDirectory
  );
  const parsedSource = filename => JSON.parse(nextBytes.get(filename) ?? read(`${sourcesPath}/${filename}`));
  validateBuildingLabels(parsedSource(labelsFile), parsedSource(buildingsFile), {contractsDirectory});

  const writes = [...nextBytes].map(([filename, bytes]) => [`${sourcesPath}/${filename}`, bytes]);
  if (places) writes.push([policyPath, policyBytes]);
  writes.push(
    ...provenanceWrites(root, nextBytes, policyBytes, places, {visibilityConfigBytes, contractsDirectory})
  );
  if (recordsCorrections) {
    const ledger = readLedger(root);
    ledger.corrections.push(...ledgerEntries({...changeset, operations}, now));
    writes.push([ledgerPath, JSON.stringify(ledger, null, 2) + '\n']);
  }
  writeChecked(root, writes, checkFinalData, contractsDirectory);
  const changedFiles = [...nextBytes.keys()];
  return {
    files: changedFiles,
    operations: changeset.operations.length,
    fieldItems: changeset.fieldItems?.length ?? 0,
    needsTileRebuild: changedFiles.some(filename => !tileRebuildExceptions.has(filename))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [changesetPath, ...remainingArguments] = process.argv.slice(2);
  if (!changesetPath) throw new Error('Usage: apply-changeset.mjs <changeset.json> --contracts-directory <directory>');
  const contractsDirectory = contractsDirectoryFrom(
    remainingArguments,
    'apply-changeset.mjs <changeset.json>'
  );
  const summary = applyChangeset(JSON.parse(fs.readFileSync(changesetPath)), rootDirectory, {
    contractsDirectory
  });
  console.log(
    `Applied ${summary.operations} operations to ${summary.files.join(', ')}. Review the diff before committing.`
  );
  if (summary.fieldItems > 0)
    console.log(`${summary.fieldItems} field items stay in the changeset: finish them in the editor.`);
  if (summary.needsTileRebuild)
    console.log('Display geometry changed: run make -C data build-data and review the release.');
}
