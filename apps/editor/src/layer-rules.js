import {isValidCoordinate, lineProblem, polygonProblem} from './geometry-validation.js';

// The same checks as data/tools/apply-changeset.mjs, so a refusal happens at the edit and not after the export.
// The shared fixtures in packages/contracts/fixtures and tests/integration keep the two in step; the importer stays
// the final authority.
const placesFile = 'places.geojson';
const placeIdentityFields = ['id', 'source'];
const newFeatureFields = ['type', 'properties', 'geometry'];
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

// Reads packages/contracts/editor-layers.json. A file without rules could never be exported, so fail at startup.
export function validateLayerRules(rules, sourceFiles) {
  if (rules?.version !== 1 || !rules.layers) throw new Error('Unsupported editing rules.');
  for (const filename of sourceFiles) {
    if (!rules.layers[filename]) throw new Error(`Editing rules do not cover ${filename}.`);
  }
  return rules;
}

function geometryProblem(geometry, allowedTypes) {
  if (!allowedTypes.includes(geometry?.type))
    return `${geometry?.type ?? 'This'} geometry is not editable in this file`;
  if (geometry.type === 'Point') {
    return isValidCoordinate(geometry.coordinates) ? null : 'point is not a WGS84 coordinate';
  }
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

// Returns why a working feature cannot be recorded, or null. before is its source state, if it has one: geometry
// left as it was is not judged again, so two source footprints with a repeated corner can still be repaired.
export function featureProblem(feature, rule, levels, before = null) {
  const isSameGeometry = before && isSameJSON(before.geometry, feature.geometry);
  const invalidGeometry = isSameGeometry ? null : geometryProblem(feature.geometry, rule.geometries);
  return invalidGeometry ?? propertyProblem(feature.properties, rule.properties, levels, before?.properties);
}

// Only listed properties and the geometry may differ, so unknown fields, attribution and identity survive.
function lockedFieldProblem(before, after, rule) {
  const featureFields = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const name of featureFields) {
    const isEditable = name === 'properties' || name === 'geometry';
    if (!isEditable && !isSameJSON(before[name], after[name])) return `feature ${name} is not editable`;
  }
  const names = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
  for (const name of names) {
    const isEditable = Object.hasOwn(rule.properties, name);
    if (!isEditable && !isSameJSON(before.properties[name], after.properties[name])) return `${name} is not editable`;
  }
  if (rule.editableKinds && !rule.editableKinds.includes(before.properties.kind)) return 'this kind is inspect-only';
  return null;
}

// A new feature claims nothing beyond what the rules list, so it can never pass for an imported upstream fact.
function addedFeatureProblem({filename, reference, before, after}, rule, localPlaceSource) {
  const {localId} = reference;
  if (typeof localId !== 'string' || !localId.startsWith('local:')) return 'a new feature needs a local ID';
  if (before !== null) return 'a new feature has no before state';
  const unlistedField = Object.keys(after).find(name => !newFeatureFields.includes(name));
  if (unlistedField) return `a new feature must not claim a feature ${unlistedField}`;
  const isPlace = filename === placesFile;
  const allowedNames = new Set([...Object.keys(rule.properties), ...(isPlace ? placeIdentityFields : [])]);
  const unlistedName = Object.keys(after.properties).find(name => !allowedNames.has(name));
  if (unlistedName) return `a new feature must not claim ${unlistedName}`;
  if (!isPlace) return null;
  if (after.properties.id !== localId) return 'a new place must use its local ID as its id';
  return after.properties.source === localPlaceSource ? null : `a new place must have source "${localPlaceSource}"`;
}

// Returns why one changeset operation is not allowed by the rules of its file, or null.
export function operationProblem(operation, rules, levels) {
  const {filename, operation: operationKind, before, after} = operation;
  const rule = rules.layers[filename];
  if (!rule) return 'unknown source file';
  if (!rule.operations.includes(operationKind)) return `${operationKind} is not allowed`;
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
  const isListedGeometry = !feature.geometry || rule.geometries.includes(feature.geometry.type);
  const isListedKind = !rule.editableKinds || rule.editableKinds.includes(feature.properties.kind);
  const canModify = rule.operations.includes('modify') && isListedGeometry && isListedKind;
  return {
    canModify,
    canDelete: rule.operations.includes('delete') && isListedGeometry && isListedKind,
    lockReason: canModify ? null : (rule.inspectOnlyReason ?? rule.readOnlyReason ?? 'This feature is inspect-only.')
  };
}
