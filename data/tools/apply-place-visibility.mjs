// Writes properties.visibilityLevel from the reviewed policy, leaving every OSM fact untouched.
// Rerun after an intentional OSM import: extraction replaces places.geojson, while the policy persists separately.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PLACES = 'data/sources/places.geojson', POLICY = 'data/sources/place-visibility-policy.json', CONFIG = 'packages/contracts/place-visibility.json', PROVENANCE = 'data/sources/provenance.json';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const nonblank = value => typeof value === 'string' && value.trim().length > 0;

// Names the changeset that last corrected a feature, whose ledger entries say who, why and what. It is local metadata, not
// a fact about the place.
export const correctionOriginProperty = 'correction_changeset';

function withoutLevel(properties) {
  const copy = {...properties};
  delete copy.visibilityLevel;
  return copy;
}

export function validatePolicy(policy, config, places) {
  const levels = new Set(config.levels.map(entry => entry.level));
  const level = (value, label) => { if (!levels.has(value)) throw new Error(`${label}: unsupported level ${value}`); };
  if (policy?.version !== 1) throw new Error('Visibility policy: unsupported version');
  level(policy.fallbackLevel, 'fallbackLevel');
  if (policy.fallbackLevel === 1) throw new Error('fallbackLevel: level 1 needs an individually reviewed override');
  for (const [kind, value] of Object.entries(policy.kinds ?? {})) {
    level(value, `kind ${kind}`);
    if (value === 1) throw new Error(`kind ${kind}: level 1 needs an individually reviewed override, not a kind rule`);
  }
  for (const [category, value] of Object.entries(policy.categories ?? {})) {
    level(value, `category ${category}`);
    if (value === 1) throw new Error(`category ${category}: level 1 needs an individually reviewed override, not a category rule`);
  }
  if (!Array.isArray(policy.overrides)) throw new Error('Visibility policy: overrides must be an array');
  const byId = new Map(places.map(feature => [feature.properties.id, feature])), seen = new Set();
  for (const override of policy.overrides) {
    const label = `Override ${override?.id}`;
    if (!byId.has(override?.id)) throw new Error(`${label}: unknown place id`);
    if (seen.has(override.id)) throw new Error(`${label}: duplicate place id`);
    seen.add(override.id);
    level(override.level, label);
    if (!nonblank(override.reason)) throw new Error(`${label}: missing reason`);
    const {basis, reviewedBy, reviewedAt} = override.provenance ?? {};
    if (!['editorial', 'commercial'].includes(basis) || !nonblank(reviewedBy) || !Number.isFinite(Date.parse(reviewedAt))) throw new Error(`${label}: incomplete provenance`);
    if (typeof override.active !== 'boolean') throw new Error(`${label}: active must be explicit`);
    if (basis === 'commercial' && override.active) throw new Error(`${label}: commercial placements are not active in this release`);
    if (override.level === 1 && (basis !== 'editorial' || byId.get(override.id).properties.category !== 'sights')) throw new Error(`${label}: level 1 is reserved for editorially reviewed landmarks`);
  }
}

// Precedence: active ID override, kind rule, category default, then fallback (unknown or missing kind/category).
export function resolveLevel(properties, policy, overrides = new Map()) {
  if (overrides.has(properties.id)) return overrides.get(properties.id);
  if (typeof properties.kind !== 'string' || !properties.kind) return policy.fallbackLevel;
  if (Object.hasOwn(policy.kinds, properties.kind)) return policy.kinds[properties.kind];
  return Object.hasOwn(policy.categories, properties.category) ? policy.categories[properties.category] : policy.fallbackLevel;
}

export function applyVisibility(collection, policy, config) {
  validatePolicy(policy, config, collection.features);
  const overrides = new Map(policy.overrides.filter(override => override.active).map(override => [override.id, override.level]));
  return {...collection, features: collection.features.map(feature => {
    const properties = withoutLevel(feature.properties);
    return {...feature, properties: {...properties, visibilityLevel: resolveLevel(properties, policy, overrides)}};
  })};
}

export function withoutVisibility(collection) {
  return {...collection, features: collection.features.map(feature => ({...feature, properties: withoutLevel(feature.properties)}))};
}

export const serializePlaces = collection => JSON.stringify(collection);
// Only facts count: neither a level nor the record of who corrected something changes what is known about a place.
export function placeFactsHash(collection) {
  const facts = withoutVisibility(collection);
  const features = facts.features.map(feature => {
    const properties = {...feature.properties};
    delete properties[correctionOriginProperty];
    return {...feature, properties};
  });
  return sha256(serializePlaces({...facts, features}));
}

export function placesProvenance(bytes, collection, policyBytes, configBytes) {
  return {places_bytes: Buffer.byteLength(bytes), places_sha256: sha256(bytes), places_facts_sha256: placeFactsHash(collection), place_visibility_policy_sha256: sha256(policyBytes), place_visibility_config_sha256: sha256(configBytes)};
}

export function run(argv, root = rootDirectory) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const policyBytes = read(POLICY), configBytes = read(CONFIG), current = read(PLACES);
  const next = serializePlaces(applyVisibility(JSON.parse(current), JSON.parse(policyBytes), JSON.parse(configBytes)));
  if (argv.includes('--check')) {
    if (next !== current) throw new Error(`${PLACES} differs from the visibility policy. Run node data/tools/apply-place-visibility.mjs and review it.`);
    console.log('Place visibility levels match the reviewed policy.');
    return;
  }
  const collection = JSON.parse(next), counts = {};
  for (const feature of collection.features) counts[feature.properties.visibilityLevel] = (counts[feature.properties.visibilityLevel] ?? 0) + 1;
  const entry = placesProvenance(next, collection, policyBytes, configBytes);
  const update = argv.includes('--update-provenance');
  const provenance = update ? JSON.parse(read(PROVENANCE)) : null;
  // Refuse before writing anything, so a refusal leaves the reviewed files as they were.
  if (update && provenance.places_facts_sha256 && provenance.places_facts_sha256 !== entry.places_facts_sha256 && !argv.includes('--accept-new-facts')) throw new Error('Place facts changed. Review the import, then pass --accept-new-facts.');
  fs.writeFileSync(path.join(root, PLACES), next);
  if (update) fs.writeFileSync(path.join(root, PROVENANCE), JSON.stringify({...provenance, ...entry, places_count: collection.features.length}, null, 2) + '\n');
  console.log(`Wrote ${collection.features.length} places by level ${JSON.stringify(counts)}. places_sha256=${entry.places_sha256}${argv.includes('--update-provenance') ? ' (provenance updated)' : ' (provenance not updated)'}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run(process.argv.slice(2));
