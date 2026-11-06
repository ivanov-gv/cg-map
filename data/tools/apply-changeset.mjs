// Applies a reviewed editor changeset to data/sources. Everything is validated before the first write, writes are
// staged, and a failed final check restores the reviewed files. See docs/runbooks/data.md.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {applyVisibility, placesProvenance, resolveLevel, serializePlaces} from './apply-place-visibility.mjs';
import {checkData, validateBuildingLabels, validateCollection} from './check-data.mjs';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcesPath = 'data/sources';
const policyPath = 'data/sources/place-visibility-policy.json';
const levelsPath = 'packages/contracts/place-visibility.json';
const rulesPath = 'packages/contracts/editor-layers.json';
const provenancePath = 'data/sources/provenance.json';
const labelProvenancePath = 'data/sources/building-labels.provenance.json';
const ledgerPath = 'data/sources/editor-corrections.json';
// Source coordinates have at most six or so decimals, so a smaller cross product can only mean collinear points.
const collinearToleranceDegreesSquared = 1e-13;
const placeIdentityFields = ['id', 'source'];
const newFeatureFields = ['type', 'properties', 'geometry'];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fingerprint = feature => sha256(JSON.stringify(feature));
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

function requireThat(condition, message) {
  if (!condition) throw new Error(`Changeset refused: ${message}`);
}

const isValidCoordinate = coordinate =>
  Array.isArray(coordinate) &&
  coordinate.length === 2 &&
  coordinate.every(Number.isFinite) &&
  Math.abs(coordinate[0]) <= 180 &&
  Math.abs(coordinate[1]) <= 90;

// Twice the signed area of a triangle, in degrees squared; near zero means the points are collinear.
function crossProduct(first, second, third) {
  return (second[0] - first[0]) * (third[1] - first[1]) - (second[1] - first[1]) * (third[0] - first[0]);
}

function pointTouchesSegment(start, end, point) {
  const isCollinear = Math.abs(crossProduct(start, end, point)) < collinearToleranceDegreesSquared;
  const isInsideBounds =
    point[0] >= Math.min(start[0], end[0]) &&
    point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) &&
    point[1] <= Math.max(start[1], end[1]);
  return isCollinear && isInsideBounds;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const isSecondAcrossFirst =
    crossProduct(firstStart, firstEnd, secondStart) * crossProduct(firstStart, firstEnd, secondEnd) < 0;
  const isFirstAcrossSecond =
    crossProduct(secondStart, secondEnd, firstStart) * crossProduct(secondStart, secondEnd, firstEnd) < 0;
  if (isSecondAcrossFirst && isFirstAcrossSecond) return true;
  return (
    pointTouchesSegment(firstStart, firstEnd, secondStart) ||
    pointTouchesSegment(firstStart, firstEnd, secondEnd) ||
    pointTouchesSegment(secondStart, secondEnd, firstStart) ||
    pointTouchesSegment(secondStart, secondEnd, firstEnd)
  );
}

function ringHasIntersectingEdges(ring) {
  const edgeCount = ring.length - 1;
  for (let first = 0; first < edgeCount; first += 1) {
    for (let second = first + 2; second < edgeCount; second += 1) {
      const isClosingNeighbor = first === 0 && second === edgeCount - 1;
      if (isClosingNeighbor) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) return true;
    }
  }
  return false;
}

// Ray casting: a horizontal ray from the point crosses a ring's edges an odd number of times when inside.
function pointInsideRing([longitude, latitude], ring) {
  let isInside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [startLongitude, startLatitude] = ring[index];
    const [endLongitude, endLatitude] = ring[previous];
    const spansLatitude = startLatitude > latitude !== endLatitude > latitude;
    if (!spansLatitude) continue;
    const crossingLongitude =
      startLongitude + ((latitude - startLatitude) / (endLatitude - startLatitude)) * (endLongitude - startLongitude);
    if (longitude < crossingLongitude) isInside = !isInside;
  }
  return isInside;
}

function ringsCross(firstRing, secondRing) {
  for (let first = 0; first < firstRing.length - 1; first += 1) {
    for (let second = 0; second < secondRing.length - 1; second += 1) {
      if (segmentsIntersect(firstRing[first], firstRing[first + 1], secondRing[second], secondRing[second + 1])) {
        return true;
      }
    }
  }
  return false;
}

// Returns why a closed ring is unusable, or null. The editor applies the same rules to the same shared fixture.
export function ringProblem(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 'ring needs at least three corners';
  if (!ring.every(isValidCoordinate)) return 'ring has an invalid coordinate';
  if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) return 'ring is not closed';
  const corners = ring.slice(0, -1);
  if (new Set(corners.map(String)).size !== corners.length) return 'ring repeats a corner';
  if (ringHasIntersectingEdges(ring)) return 'ring edges cross or touch';
  const twiceArea = corners.reduce((area, corner, index) => {
    const next = ring[index + 1];
    return area + corner[0] * next[1] - next[0] * corner[1];
  }, 0);
  return Math.abs(twiceArea) < collinearToleranceDegreesSquared ? 'ring has no area' : null;
}

// Returns why an open line is unusable, or null.
export function lineProblem(line) {
  if (!Array.isArray(line) || line.length < 2) return 'line needs at least two points';
  if (!line.every(isValidCoordinate)) return 'line has an invalid coordinate';
  return new Set(line.map(String)).size < 2 ? 'line needs two distinct points' : null;
}

// Returns why a polygon's rings do not form one shape with holes, or null.
export function polygonProblem(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return 'polygon has no rings';
  const invalidRing = rings.map(ringProblem).find(Boolean);
  if (invalidRing) return invalidRing;
  const [outerRing, ...holes] = rings;
  if (holes.some(hole => !hole.every(corner => pointInsideRing(corner, outerRing)))) {
    return 'hole is outside its polygon';
  }
  for (let first = 0; first < rings.length; first += 1) {
    for (let second = first + 1; second < rings.length; second += 1) {
      if (ringsCross(rings[first], rings[second])) return 'polygon rings cross or touch';
    }
  }
  return null;
}

function geometryProblem(geometry, allowedTypes) {
  if (!allowedTypes.includes(geometry?.type)) return `geometry type ${geometry?.type} is not editable in this file`;
  if (geometry.type === 'Point')
    return isValidCoordinate(geometry.coordinates) ? null : 'point is not a WGS84 coordinate';
  if (geometry.type === 'LineString') return lineProblem(geometry.coordinates);
  return polygonProblem(geometry.coordinates);
}

function isForbiddenValue(value, propertyRule) {
  if (!propertyRule.forbiddenValues) return false;
  const ignoredCharacters = new RegExp(propertyRule.ignoredCharactersPattern, 'g');
  return propertyRule.forbiddenValues.includes(value.toLowerCase().replace(ignoredCharacters, ''));
}

// Returns why these properties cannot be recorded, or null. A value equal to the source's stands as it is: most roads
// have a blank name, and editing their geometry must not have to invent one.
export function propertyProblem(properties, propertyRules, levels, previousProperties = {}) {
  for (const [name, propertyRule] of Object.entries(propertyRules)) {
    const value = properties[name];
    if (value === undefined) {
      if (propertyRule.required) return `${name} is required`;
      continue;
    }
    // A level stands as it was only while the category it depends on does too.
    const isCategoryChange = propertyRule.isLevel && !isSameJSON(properties.category, previousProperties.category);
    if (isSameJSON(value, previousProperties[name]) && !isCategoryChange) continue;
    if (propertyRule.isLevel) {
      if (!levels.has(value)) return `${name} is not a supported level`;
      if (value === propertyRule.landmarkLevel && properties.category !== propertyRule.landmarkCategory) {
        return `${name} ${value} is reserved for ${propertyRule.landmarkCategory} landmarks`;
      }
      continue;
    }
    if (typeof value !== 'string' || value.trim().length === 0) return `${name} must be nonempty text`;
    if (propertyRule.maxLength && value.length > propertyRule.maxLength) return `${name} is too long`;
    if (propertyRule.enum && !propertyRule.enum.includes(value)) return `${name} is not an allowed value`;
    if (isForbiddenValue(value, propertyRule)) return `${name} is a placeholder, not a value`;
  }
  return null;
}

// Only listed properties and the geometry may differ, so unknown fields, attribution and identity survive.
function changedLockedField(before, after, rule) {
  const featureFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of featureFields) {
    const isEditable = name === 'properties' || name === 'geometry';
    if (!isEditable && !isSameJSON(before[name], after[name])) return `feature ${name}`;
  }
  const names = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
  for (const name of names) {
    const isEditable = Object.hasOwn(rule.properties, name);
    if (!isEditable && !isSameJSON(before.properties[name], after.properties[name])) return name;
  }
  return null;
}

// A new feature claims nothing beyond what the rules list, so it can never pass for an imported upstream fact.
function checkAddedFeature(operation, rule, localPlaceSource) {
  const {filename, reference, before, beforeFingerprint, after} = operation;
  const {localId} = reference;
  requireThat(
    typeof localId === 'string' && localId.startsWith('local:'),
    `${filename}: a new feature needs a local ID`
  );
  requireThat(before === null && beforeFingerprint === null, `${filename}: a new feature has no before state`);
  const unlistedField = Object.keys(after).find(name => !newFeatureFields.includes(name));
  requireThat(!unlistedField, `${filename}: a new feature must not claim a feature ${unlistedField}`);
  const isPlace = filename === 'places.geojson';
  const allowedNames = new Set([...Object.keys(rule.properties), ...(isPlace ? placeIdentityFields : [])]);
  const unlistedName = Object.keys(after.properties).find(name => !allowedNames.has(name));
  requireThat(!unlistedName, `${filename}: a new feature must not claim ${unlistedName}`);
  if (!isPlace) return;
  requireThat(after.properties.id === localId, 'a new place must use its local ID as its id');
  requireThat(after.properties.source === localPlaceSource, `a new place must have source "${localPlaceSource}"`);
}

function checkExistingFeature(operation, source) {
  const {featureIndex} = operation.reference;
  const current = source.features[featureIndex];
  requireThat(current, `${operation.filename}: feature ${featureIndex} does not exist in this snapshot`);
  requireThat(
    fingerprint(current) === operation.beforeFingerprint,
    `${operation.filename}: feature ${featureIndex} differs from the reviewed fingerprint`
  );
  requireThat(
    isSameJSON(current, operation.before),
    `${operation.filename}: feature ${featureIndex} differs from its recorded before state`
  );
}

function checkModification({before, after}, rule, featureLabel) {
  const lockedField = changedLockedField(before, after, rule);
  requireThat(!lockedField, `${featureLabel}: ${lockedField} is not editable`);
  if (rule.editableKinds) {
    requireThat(rule.editableKinds.includes(before.properties.kind), `${featureLabel}: this kind is inspect-only`);
  }
}

// Throws unless this one operation is allowed by the rules of its file and matches the pinned snapshot.
function checkOperation(operation, sources, rules, levels) {
  const {filename, operation: operationKind, reference, before, after} = operation;
  const rule = rules.layers[filename];
  requireThat(rule, `unknown source file ${filename}`);
  requireThat(rule.operations.includes(operationKind), `${operationKind} is not allowed in ${filename}`);
  const featureLabel = `${filename} ${JSON.stringify(reference)}`;
  if (operationKind === 'delete') {
    requireThat(after === null, `${featureLabel}: a deletion has no after state`);
    checkExistingFeature(operation, sources.get(filename));
    return;
  }
  requireThat(after?.type === 'Feature' && after.properties, `${filename}: invalid feature`);
  if (operationKind === 'add') checkAddedFeature(operation, rule, rules.localPlaceSource);
  else checkExistingFeature(operation, sources.get(filename));
  const isSameGeometry = before && isSameJSON(before.geometry, after.geometry);
  const invalidGeometry = isSameGeometry ? null : geometryProblem(after.geometry, rule.geometries);
  requireThat(!invalidGeometry, `${featureLabel}: ${invalidGeometry}`);
  const invalidProperty = propertyProblem(after.properties, rule.properties, levels, before?.properties);
  requireThat(!invalidProperty, `${featureLabel}: ${invalidProperty}`);
  if (operationKind === 'modify') checkModification(operation, rule, featureLabel);
}

function checkEnvelope(changeset) {
  requireThat(changeset?.version === 1, 'unsupported version');
  for (const field of ['id', 'author', 'reason']) {
    requireThat(typeof changeset[field] === 'string' && changeset[field].trim().length > 0, `${field} is required`);
  }
  requireThat(Number.isFinite(Date.parse(changeset.createdAt)), 'createdAt is not a date');
  requireThat(Array.isArray(changeset.operations) && changeset.operations.length > 0, 'no operations');
  const references = changeset.operations.map(({filename, reference}) => `${filename}:${JSON.stringify(reference)}`);
  requireThat(new Set(references).size === references.length, 'two operations target the same feature');
  for (const {filename} of changeset.operations) {
    requireThat(Object.hasOwn(changeset.bases ?? {}, filename), `${filename} has no base hash`);
  }
}

// Reads each changed source and stops if it is not the revision this changeset was made from.
function readPinnedSources(changeset, root) {
  const sources = new Map();
  const originalBytes = new Map();
  for (const [filename, expectedHash] of Object.entries(changeset.bases)) {
    requireThat(/^[a-z][a-z-]*\.geojson$/.test(filename), `unsafe source file ${filename}`);
    const bytes = fs.readFileSync(path.join(root, sourcesPath, filename));
    requireThat(sha256(bytes) === expectedHash, `${filename} differs from the base of this changeset`);
    sources.set(filename, JSON.parse(bytes));
    originalBytes.set(filename, bytes);
  }
  return {sources, originalBytes};
}

// Existing features keep their index until deletions are applied last, so references stay valid while applying.
function applyOperations(source, operations) {
  const features = [...source.features];
  const added = [];
  for (const operation of operations) {
    if (operation.operation === 'add') added.push(operation.after);
    else features[operation.reference.featureIndex] = operation.after;
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

function serializeLayer(collection, originalBytes) {
  const hasFinalNewline = originalBytes.at(-1) === 0x0a;
  return JSON.stringify(collection) + (hasFinalNewline ? '\n' : '');
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

function provenanceWrites(root, nextBytes, policyBytes, places) {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const provenance = JSON.parse(read(provenancePath));
  const labelProvenance = JSON.parse(read(labelProvenancePath));
  const bytesOf = filename => nextBytes.get(filename) ?? fs.readFileSync(path.join(root, sourcesPath, filename));
  for (const name of Object.keys(provenance.layers)) {
    const bytes = bytesOf(name);
    provenance.layers[name] = {
      ...provenance.layers[name],
      features: JSON.parse(bytes).features.length,
      bytes: Buffer.byteLength(bytes),
      sha256: sha256(bytes)
    };
  }
  const labelBytes = bytesOf('building-labels.geojson');
  labelProvenance.bytes = Buffer.byteLength(labelBytes);
  labelProvenance.sha256 = sha256(labelBytes);
  labelProvenance.buildings_sha256 = sha256(bytesOf('buildings.geojson'));
  if (places) {
    const placeBytes = nextBytes.get('places.geojson');
    Object.assign(provenance, placesProvenance(placeBytes, places, policyBytes, read(levelsPath)), {
      places_count: places.features.length
    });
  }
  return [
    [provenancePath, JSON.stringify(provenance, null, 2) + '\n'],
    [labelProvenancePath, JSON.stringify(labelProvenance, null, 2) + '\n']
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

// The new bytes of every changed source, plus the policy and regenerated places when places changed.
function serializedResults(changeset, sources, originalBytes, policyText, levelConfig) {
  const nextBytes = new Map();
  let policyBytes = policyText;
  let places = null;
  for (const [filename, source] of sources) {
    const operations = changeset.operations.filter(operation => operation.filename === filename);
    const nextSource = applyOperations(source, operations);
    if (filename === 'places.geojson') {
      const policy = policyWithLevelEdits(JSON.parse(policyText), operations, changeset);
      policyBytes = JSON.stringify(policy, null, 2) + '\n';
      places = applyVisibility(nextSource, policy, levelConfig);
      validateCollection(places, {places: true, label: 'places'});
      nextBytes.set(filename, serializePlaces(places));
    } else {
      validateCollection(nextSource, {label: filename, requireKind: filename !== 'transport-stops.geojson'});
      nextBytes.set(filename, serializeLayer(nextSource, originalBytes.get(filename)));
    }
  }
  return {nextBytes, policyBytes, places};
}

// Returns a summary. Throws before writing when anything fails validation, leaving reviewed inputs intact, and restores
// them if the final check on the written files fails. checkFinalData exists so a test can fail that last step.
export function applyChangeset(
  changeset,
  root = rootDirectory,
  {now = new Date().toISOString(), checkFinalData = checkData} = {}
) {
  checkEnvelope(changeset);
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const rules = JSON.parse(read(rulesPath));
  const levelConfig = JSON.parse(read(levelsPath));
  const levels = new Set(levelConfig.levels.map(entry => entry.level));
  const {sources, originalBytes} = readPinnedSources(changeset, root);
  for (const operation of changeset.operations) checkOperation(operation, sources, rules, levels);
  const {nextBytes, policyBytes, places} = serializedResults(
    changeset,
    sources,
    originalBytes,
    read(policyPath),
    levelConfig
  );
  const parsedSource = filename => JSON.parse(nextBytes.get(filename) ?? read(`${sourcesPath}/${filename}`));
  validateBuildingLabels(parsedSource('building-labels.geojson'), parsedSource('buildings.geojson'));

  const writes = [...nextBytes].map(([filename, bytes]) => [`${sourcesPath}/${filename}`, bytes]);
  if (places) writes.push([policyPath, policyBytes]);
  writes.push(...provenanceWrites(root, nextBytes, policyBytes, places));
  const ledger = readLedger(root);
  ledger.corrections.push(...ledgerEntries(changeset, now));
  writes.push([ledgerPath, JSON.stringify(ledger, null, 2) + '\n']);

  const restore = writeStaged(root, writes);
  try {
    checkFinalData(root);
  } catch (error) {
    const restoreNote = restore();
    const outcome = restoreNote ? 'reviewed files not fully restored' : 'reviewed files restored';
    throw new Error(`Changeset refused, ${outcome}: ${error.message}.${restoreNote}`, {cause: error});
  }
  const needsTileRebuild = [...nextBytes.keys()].some(
    filename => filename !== 'places.geojson' && filename !== 'building-labels.geojson'
  );
  return {files: [...nextBytes.keys()], operations: changeset.operations.length, needsTileRebuild};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changesetPath = process.argv[2];
  if (!changesetPath) throw new Error('Usage: apply-changeset.mjs <changeset.json>');
  const summary = applyChangeset(JSON.parse(fs.readFileSync(changesetPath)));
  console.log(
    `Applied ${summary.operations} operations to ${summary.files.join(', ')}. Review the diff before committing.`
  );
  if (summary.needsTileRebuild)
    console.log('Display geometry changed: run make -C data build-data and review the release.');
}
