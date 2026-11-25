// What an editor changeset may do, read from the shared editor-layers contract. The editor applies the same rules
// before it records an edit (apps/editor/src/layer-rules.js); the shared fixtures keep the two in step.
import {derivedGeometryProblem, geometryProblem} from './changeset-geometry.mjs';

const placesFile = 'places.geojson';
const stopsFile = 'transport-stops.geojson';
const placeIdentityFields = ['id', 'source'];
const newFeatureFields = ['type', 'properties', 'geometry'];
const sourceIdentityFields = ['entityId', 'entityVersion', 'entityPart'];
const supportedRulesVersion = 2;
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

export function requireThat(condition, message) {
  if (!condition) throw new Error(`Changeset refused: ${message}`);
}

export function requireSupportedRules(rules) {
  requireThat(rules?.version === supportedRulesVersion, 'unsupported editing rules');
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

// A label mark is a WGS84 longitude/latitude pair, not a pixel point.
const isPosition = value => isCoordinatePair(value) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

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
  entrances: entrancesProblem,
  position: (name, value) => (isPosition(value) ? null : `${name} must be a WGS84 longitude/latitude pair`)
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

// Only listed properties and the geometry may differ, so unknown fields, attribution and identity survive.
function changedLockedField(before, after, rule, limits) {
  const featureFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of featureFields) {
    const isEditable = name === 'properties' || (name === 'geometry' && limits.allowsGeometry);
    if (!isEditable && !isSameJSON(before[name], after[name])) return `feature ${name}`;
  }
  const names = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
  for (const name of names) {
    const propertyRule = Object.hasOwn(rule.properties, name) ? rule.properties[name] : null;
    const isListed = propertyRule && !propertyRule.addOnly;
    const isEditable = isListed && (!limits.propertyNames || limits.propertyNames.includes(name));
    if (!isEditable && !isSameJSON(before.properties[name], after.properties[name])) return name;
  }
  return null;
}

function checkAddedPlace(after, localId, localPlaceSource) {
  requireThat(after.properties.id === localId, 'a new place must use its local ID as its id');
  requireThat(after.properties.source === localPlaceSource, `a new place must have source "${localPlaceSource}"`);
}

function checkAddedStop(after, localId) {
  const isOwnIdentity = after.id === localId && after.properties.stopId === localId;
  requireThat(isOwnIdentity, 'a new stop must use its local ID as its stop ID');
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
  const allowedFields = filename === stopsFile ? [...newFeatureFields, 'id'] : newFeatureFields;
  const unlistedField = Object.keys(after).find(name => !allowedFields.includes(name));
  requireThat(!unlistedField, `${filename}: a new feature must not claim a feature ${unlistedField}`);
  const isPlace = filename === placesFile;
  const allowedNames = new Set([...Object.keys(rule.properties), ...(isPlace ? placeIdentityFields : [])]);
  const claimedIdentity = sourceIdentityFields.find(name => Object.hasOwn(after.properties, name));
  requireThat(!claimedIdentity, `${filename}: a new feature must not claim ${claimedIdentity}`);
  const unlistedName = Object.keys(after.properties).find(name => !allowedNames.has(name));
  requireThat(!unlistedName, `${filename}: a new feature must not claim ${unlistedName}`);
  for (const [name, propertyRule] of Object.entries(rule.properties)) {
    const isMissing = propertyRule.requiredOnAdd && after.properties[name] === undefined;
    requireThat(!isMissing, `${filename}: a new feature needs ${name}`);
  }
  const isDerivedKind = Object.hasOwn(rule.limitedKinds ?? {}, after.properties.kind);
  requireThat(!isDerivedKind, `${filename}: ${after.properties.kind} cannot be added`);
  if (isPlace) checkAddedPlace(after, localId, localPlaceSource);
  if (filename === stopsFile) checkAddedStop(after, localId);
}

// What an entrance is comes from OSM and stays locked; only where it is on the wall follows its building.
function changesEntranceFacts(before, after) {
  const factsOf = feature =>
    (feature.properties.entrances ?? []).map(entrance => ({...entrance, coordinates: null, bearing: null}));
  return !isSameJSON(factsOf(before), factsOf(after));
}

function checkModification({before, after}, rule, limits, featureLabel) {
  const lockedField = changedLockedField(before, after, rule, limits);
  requireThat(!lockedField, `${featureLabel}: ${lockedField} is not editable`);
  requireThat(!changesEntranceFacts(before, after), `${featureLabel}: entrances can only move with their building`);
  const {kind} = before.properties;
  const isListedKind =
    !rule.editableKinds || rule.editableKinds.includes(kind) || Object.hasOwn(rule.limitedKinds ?? {}, kind);
  requireThat(isListedKind, `${featureLabel}: this kind is inspect-only`);
}

// Throws unless this one operation is allowed by the rules of its file. Whether it still matches the snapshot is
// checked where references are resolved.
export function checkOperationRules(operation, rules, levels) {
  const {filename, operation: operationKind, reference, before, after} = operation;
  const rule = rules.layers[filename];
  requireThat(rule, `unknown source file ${filename}`);
  const limits = rulesForFeature(rule, before);
  requireThat(limits.operations.includes(operationKind), `${operationKind} is not allowed in ${filename}`);
  const featureLabel = `${filename} ${JSON.stringify(reference)}`;
  if (operationKind === 'delete') {
    requireThat(after === null, `${featureLabel}: a deletion has no after state`);
    return;
  }
  requireThat(after?.type === 'Feature' && after.properties, `${filename}: invalid feature`);
  if (operationKind === 'add') checkAddedFeature(operation, rule, rules.localPlaceSource);
  else requireThat(before?.type === 'Feature' && before.properties, `${featureLabel}: missing before state`);
  const isSameGeometry = before && isSameJSON(before.geometry, after.geometry);
  const findGeometryProblem = limits.isDerived ? derivedGeometryProblem : geometryProblem;
  const invalidGeometry = isSameGeometry ? null : findGeometryProblem(after.geometry, rule.geometries);
  requireThat(!invalidGeometry, `${featureLabel}: ${invalidGeometry}`);
  const invalidProperty = propertyProblem(after.properties, rule.properties, levels, before?.properties);
  requireThat(!invalidProperty, `${featureLabel}: ${invalidProperty}`);
  const hasRequiredAny = !rule.requiredAny || rule.requiredAny.some(name => after.properties[name] !== undefined);
  requireThat(hasRequiredAny, `${featureLabel}: one of ${rule.requiredAny?.join(', ')} is required`);
  if (operationKind === 'modify') checkModification(operation, rule, limits, featureLabel);
}
