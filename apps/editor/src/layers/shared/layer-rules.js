import {derivedGeometryProblem, geometryProblem} from '../../geometry/geometry-validation.js';

// The same checks as data/tools/apply-changeset.mjs, so a refusal happens at the edit and not after the export.
// The shared fixtures in the pinned @ivanov-gv/map-contracts package and tests/integration keep the two in step; the
// importer stays the final authority.
const placesFile = 'places.geojson';
const stopsFile = 'transport-stops.geojson';
// Version 1 rules lack typed values and limited kinds. The editor still reads them with an older reviewed bundle.
const supportedRulesVersions = [1, 2];
const placeIdentityFields = ['id', 'source'];
const newFeatureFields = ['type', 'properties', 'geometry'];
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

// Reads the pinned editor-layers contract. A file without rules could never be exported, so fail at startup.
export function validateLayerRules(rules, sourceFiles) {
  if (!supportedRulesVersions.includes(rules?.version) || !rules.layers) throw new Error('Unsupported editing rules.');
  for (const filename of sourceFiles) {
    if (!rules.layers[filename]) throw new Error(`Editing rules do not cover ${filename}.`);
  }
  return rules;
}

function isForbiddenValue(value, propertyRule) {
  if (!propertyRule.forbiddenValues) return false;
  const ignoredCharacters = new RegExp(propertyRule.ignoredCharactersPattern, 'g');
  return propertyRule.forbiddenValues.includes(value.toLowerCase().replace(ignoredCharacters, ''));
}

function textProblem(name, value, propertyRule) {
  if (typeof value !== 'string' || value.trim().length === 0) return `${name} must be nonempty text`;
  if (propertyRule.maxLength && value.length > propertyRule.maxLength) return `${name} is too long`;
  if (propertyRule.enum && !propertyRule.enum.includes(value)) return `${name} is not an allowed value`;
  if (propertyRule.pattern && !new RegExp(propertyRule.pattern).test(value)) return `${name} has an unsupported format`;
  return isForbiddenValue(value, propertyRule) ? `${name} is a placeholder, not a value` : null;
}

function numberProblem(name, value, propertyRule) {
  const isRightType = propertyRule.type === 'integer' ? Number.isInteger(value) : Number.isFinite(value);
  if (!isRightType) return `${name} must be ${propertyRule.type === 'integer' ? 'a whole number' : 'a number'}`;
  if (value < (propertyRule.minimum ?? -Infinity)) return `${name} is below ${propertyRule.minimum}`;
  if (value > (propertyRule.maximum ?? Infinity)) return `${name} is above ${propertyRule.maximum}`;
  const isOnStep = !propertyRule.multipleOf || value % propertyRule.multipleOf === 0;
  return isOnStep ? null : `${name} must be a multiple of ${propertyRule.multipleOf}`;
}

function listProblem(name, value, propertyRule) {
  const isTextList =
    Array.isArray(value) &&
    value.every(
      entry => typeof entry === 'string' && entry.trim().length > 0 && entry.length <= propertyRule.maxLength
    );
  return isTextList ? null : `${name} must be a list of nonempty texts`;
}

const localIdPattern = /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The OSM number of a road or junction, or the local ID of one that came from the editor.
const isIdentifier = value => (Number.isSafeInteger(value) && value > 0) || localIdPattern.test(value);

function identifiersProblem(name, value) {
  const areIdentifiers = Array.isArray(value) && value.every(isIdentifier);
  return areIdentifiers ? null : `${name} must be a list of OSM numbers or local IDs`;
}

const isCoordinatePair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);

// A stop of a route is a stop ID, a positioned stop outside the stop file, or a turn point the route must pass.
function isRouteStop(stop) {
  if (typeof stop === 'string') return stop.length > 0;
  if (isCoordinatePair(stop?.turn)) return true;
  return typeof stop?.id === 'string' && isCoordinatePair(stop.coordinates);
}

const isTurnPoint = stop => typeof stop === 'object' && stop !== null && Object.hasOwn(stop, 'turn');

function directionsProblem(name, value) {
  if (!Array.isArray(value) || value.length === 0) return `${name} needs at least one direction`;
  for (const direction of value) {
    if (typeof direction?.headsign !== 'string') return `${name} needs a headsign`;
    if (!Array.isArray(direction.stops) || !direction.stops.every(isRouteStop)) return `${name} has an invalid stop`;
    const servedStops = direction.stops.filter(stop => !isTurnPoint(stop));
    if (servedStops.length < 2) return `${name} needs at least two stops`;
  }
  return null;
}

// Located entrances of a label. An edit may only move them with their building: what an entrance is stays as it was.
function entrancesProblem(name, value) {
  const areLocated =
    Array.isArray(value) && value.every(entrance => typeof entrance?.id === 'string' && isCoordinatePair(entrance.coordinates));
  return areLocated ? null : `${name} need an ID and a position each`;
}

const problemByType = {
  integer: numberProblem,
  number: numberProblem,
  boolean: (name, value) => (typeof value === 'boolean' ? null : `${name} must be yes or no`),
  list: listProblem,
  identifier: (name, value) => (isIdentifier(value) ? null : `${name} must be an OSM number or a local ID`),
  identifiers: identifiersProblem,
  directions: directionsProblem,
  entrances: entrancesProblem
};

function levelProblem(name, properties, propertyRule, levels) {
  const value = properties[name];
  if (!levels.has(value)) return `${name} is not a supported level`;
  const isReserved =
    value === propertyRule.landmarkLevel && properties.category !== propertyRule.landmarkCategory;
  return isReserved ? `${name} ${value} is reserved for ${propertyRule.landmarkCategory} landmarks` : null;
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
    if (value === null && propertyRule.allowsNull) continue;
    const findProblem = problemByType[propertyRule.type] ?? textProblem;
    const problem = propertyRule.isLevel
      ? levelProblem(name, properties, propertyRule, levels)
      : findProblem(name, value, propertyRule);
    if (problem) return problem;
  }
  return null;
}

// What this feature allows. A kind the pipeline derives, such as the ocean, is limited further than its file.
function rulesForFeature(rule, feature) {
  const limits = rule.limitedKinds?.[feature?.properties?.kind];
  if (!limits) return {operations: rule.operations, allowsGeometry: true, isDerived: rule.derivedGeometry === true};
  return {
    operations: limits.operations,
    allowsGeometry: limits.geometry,
    isDerived: true,
    propertyNames: limits.properties
  };
}

// Whether the rules of its file cover this kind at all.
function isListedKind(feature, rule) {
  const {kind} = feature.properties;
  return !rule.editableKinds || rule.editableKinds.includes(kind) || Object.hasOwn(rule.limitedKinds ?? {}, kind);
}

// Returns why a working feature cannot be recorded, or null. before is its source state, if it has one: geometry
// left as it was is not judged again, so two source footprints with a repeated corner can still be repaired.
export function featureProblem(feature, rule, levels, before = null) {
  const {isDerived} = rulesForFeature(rule, before);
  const findGeometryProblem = isDerived ? derivedGeometryProblem : geometryProblem;
  const isSameGeometry = before && isSameJSON(before.geometry, feature.geometry);
  const invalidGeometry = isSameGeometry ? null : findGeometryProblem(feature.geometry, rule.geometries);
  const problem = invalidGeometry ?? propertyProblem(feature.properties, rule.properties, levels, before?.properties);
  if (problem) return problem;
  const hasRequiredAny = !rule.requiredAny || rule.requiredAny.some(name => feature.properties[name] !== undefined);
  return hasRequiredAny ? null : `one of ${rule.requiredAny.join(', ')} is required`;
}

// What an entrance is comes from OSM and stays locked; only where it is on the wall follows its building.
function changesEntranceFacts(before, after) {
  const factsOf = feature =>
    (feature.properties.entrances ?? []).map(entrance => ({...entrance, coordinates: null, bearing: null}));
  return !isSameJSON(factsOf(before), factsOf(after));
}

// Only listed properties and the geometry may differ, so unknown fields, attribution and identity survive.
function lockedFieldProblem(before, after, rule) {
  const limits = rulesForFeature(rule, before);
  const featureFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of featureFields) {
    const isEditable = name === 'properties' || (name === 'geometry' && limits.allowsGeometry);
    if (!isEditable && !isSameJSON(before[name], after[name])) return `feature ${name} is not editable`;
  }
  const names = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
  for (const name of names) {
    const propertyRule = Object.hasOwn(rule.properties, name) ? rule.properties[name] : null;
    const isListed = propertyRule && !propertyRule.addOnly;
    const isEditable = isListed && (!limits.propertyNames || limits.propertyNames.includes(name));
    if (!isEditable && !isSameJSON(before.properties[name], after.properties[name])) return `${name} is not editable`;
  }
  if (changesEntranceFacts(before, after)) return 'entrances can only move with their building';
  return isListedKind(before, rule) ? null : 'this kind is inspect-only';
}

function addedPlaceProblem({properties}, localId, localPlaceSource) {
  if (properties.id !== localId) return 'a new place must use its local ID as its id';
  return properties.source === localPlaceSource ? null : `a new place must have source "${localPlaceSource}"`;
}

function addedStopProblem(after, localId) {
  const isOwnIdentity = after.id === localId && after.properties.stopId === localId;
  return isOwnIdentity ? null : 'a new stop must use its local ID as its stop ID';
}

// A new feature claims nothing beyond what the rules list, so it can never pass for an imported upstream fact.
function addedFeatureProblem({filename, reference, before, after}, rule, localPlaceSource) {
  const {localId} = reference;
  if (typeof localId !== 'string' || !localId.startsWith('local:')) return 'a new feature needs a local ID';
  if (before !== null) return 'a new feature has no before state';
  const allowedFields = filename === stopsFile ? [...newFeatureFields, 'id'] : newFeatureFields;
  const unlistedField = Object.keys(after).find(name => !allowedFields.includes(name));
  if (unlistedField) return `a new feature must not claim a feature ${unlistedField}`;
  const isPlace = filename === placesFile;
  const allowedNames = new Set([...Object.keys(rule.properties), ...(isPlace ? placeIdentityFields : [])]);
  const unlistedName = Object.keys(after.properties).find(name => !allowedNames.has(name));
  if (unlistedName) return `a new feature must not claim ${unlistedName}`;
  const missing = Object.entries(rule.properties).find(
    ([name, propertyRule]) => propertyRule.requiredOnAdd && after.properties[name] === undefined
  );
  if (missing) return `a new feature needs ${missing[0]}`;
  if (Object.hasOwn(rule.limitedKinds ?? {}, after.properties.kind)) return `${after.properties.kind} cannot be added`;
  if (isPlace) return addedPlaceProblem(after, localId, localPlaceSource);
  return filename === stopsFile ? addedStopProblem(after, localId) : null;
}

// Returns why one changeset operation is not allowed by the rules of its file, or null.
export function operationProblem(operation, rules, levels) {
  const {filename, operation: operationKind, before, after} = operation;
  const rule = rules.layers[filename];
  if (!rule) return 'unknown source file';
  if (!rulesForFeature(rule, before).operations.includes(operationKind)) return `${operationKind} is not allowed`;
  if (operationKind === 'delete') return after === null ? null : 'a deletion has no after state';
  if (after?.type !== 'Feature' || !after.properties) return 'invalid feature';
  const identityProblem =
    operationKind === 'add'
      ? addedFeatureProblem(operation, rule, rules.localPlaceSource)
      : lockedFieldProblem(before, after, rule);
  return identityProblem ?? featureProblem(after, rule, levels, before);
}

// Whether this file allows any edit at all, and if not, why. The reason is shown to the editor.
export function layerLockReason(rule) {
  return rule.operations.length ? null : rule.readOnlyReason;
}

// What an existing feature allows. Kinds and geometries outside the rules stay inspect-only:
// the ocean polygon is a MultiPolygon derived by the pipeline, and country shapes mirror their source.
export function featureCapabilities(feature, rule) {
  const limits = rulesForFeature(rule, feature);
  const isListedGeometry = !feature.geometry || rule.geometries.includes(feature.geometry.type);
  // A shape outside the rules can still be renamed when the rules say exactly what it allows.
  const isEditableShape = isListedGeometry || Boolean(limits.propertyNames) || rule.geometries.length === 0;
  const isAllowed = isEditableShape && isListedKind(feature, rule);
  const canModify = isAllowed && limits.operations.includes('modify');
  return {
    canModify,
    canReshape: canModify && limits.allowsGeometry && !limits.isDerived && isListedGeometry,
    canDelete: isAllowed && limits.operations.includes('delete'),
    lockReason: canModify ? null : (rule.inspectOnlyReason ?? rule.readOnlyReason ?? 'This feature is inspect-only.')
  };
}
