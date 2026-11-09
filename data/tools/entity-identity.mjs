import {readFileSync} from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../../packages/contracts/entity-identity.schema.json', import.meta.url)));
const collectionSchema = JSON.parse(readFileSync(new URL('../../packages/contracts/source-entities.schema.json', import.meta.url)));
const identifierPatterns = schema.$defs.entityId.oneOf.map(rule => {
  const definition = rule.$ref ? schema.$defs[rule.$ref.split('/').at(-1)] : rule;
  return new RegExp(definition.pattern);
});
const osmIdentifierPattern = new RegExp(schema.$defs.osmEntityId.pattern);
const contentVersionPattern = new RegExp(schema.$defs.contentVersion.pattern);
const identityFields = Object.keys(schema.properties);

// Require the entire string across regular expression engines, including before a trailing newline.
function matchesEntireString(pattern, value) {
  return typeof value === 'string' && pattern.exec(value)?.[0] === value;
}

function requireIdentity(condition, label, message) {
  if (!condition) throw new Error(`${label}: ${message}`);
}

// Identity is source metadata, never an inference from display IDs or an array index.
function validateIdentity(properties, label) {
  const {entityId, entityVersion, entityPart} = properties;
  const hasKnownIdentifier = identifierPatterns.some(pattern => matchesEntireString(pattern, entityId));
  requireIdentity(hasKnownIdentifier, label, 'invalid entityId or source prefix');
  const isOSM = matchesEntireString(osmIdentifierPattern, entityId);
  const isOSMVersion = isOSM && Number.isSafeInteger(entityVersion) && entityVersion >= schema.$defs.osmVersion.minimum;
  const isContentVersion = matchesEntireString(contentVersionPattern, entityVersion);
  requireIdentity(isOSMVersion || isContentVersion, label, 'invalid entityVersion for this source');
  const partRule = schema.properties.entityPart;
  const hasValidPart = Number.isSafeInteger(entityPart) && entityPart >= partRule.minimum;
  requireIdentity(!Object.hasOwn(properties, 'entityPart') || hasValidPart, label, 'invalid entityPart');
}

// A split entity keeps its source identity and version; part numbers distinguish its separate geometries.
function recordEntity(entities, properties, label) {
  const {entityId, entityVersion, entityPart} = properties;
  const previous = entities.get(entityId);
  if (!previous) {
    entities.set(entityId, {version: entityVersion, parts: new Set([entityPart])});
    return;
  }
  const hasDistinctPart = entityPart !== undefined && !previous.parts.has(undefined) && !previous.parts.has(entityPart);
  requireIdentity(hasDistinctPart, label, `duplicate entityId or entityPart: ${entityId}`);
  requireIdentity(previous.version === entityVersion, label, `split entity versions differ: ${entityId}`);
  previous.parts.add(entityPart);
}

// Adoption is explicit and file-wide. Legacy files stay unchanged; partial or unversioned metadata is refused.
// Geometry and domain validation remain with check-data, and this function never mutates a collection.
export function validateSourceEntities(collection, {label = 'GeoJSON'} = {}) {
  const isCollection = collection?.type === 'FeatureCollection' && Array.isArray(collection.features);
  requireIdentity(isCollection, label, 'expected FeatureCollection');
  const hasSchemaVersion = Object.hasOwn(collection, 'entitySchemaVersion');
  if (!hasSchemaVersion) {
    const hasIdentity = collection.features.some(feature =>
      identityFields.some(field => Object.hasOwn(feature?.properties ?? {}, field))
    );
    requireIdentity(!hasIdentity, label, 'entity metadata requires entitySchemaVersion');
    return;
  }
  const supportedVersion = collectionSchema.properties.entitySchemaVersion.const;
  requireIdentity(collection.entitySchemaVersion === supportedVersion, label, 'unsupported entitySchemaVersion');
  const entities = new Map();
  for (const [index, feature] of collection.features.entries()) {
    const featureLabel = `${label} feature ${index}`;
    const hasProperties = feature?.type === 'Feature' && feature.properties && typeof feature.properties === 'object' && !Array.isArray(feature.properties);
    requireIdentity(hasProperties, featureLabel, 'missing entity properties');
    validateIdentity(feature.properties, featureLabel);
    recordEntity(entities, feature.properties, featureLabel);
  }
}
