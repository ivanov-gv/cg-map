// Routes and turn restrictions are not GeoJSON. Each record becomes a feature without geometry, exactly as the importer
// wraps it (data/tools/changeset-sources.mjs), so its fingerprint is the same on both sides.
const recordLists = new Map([
  ['transit-routes.json', 'routes'],
  ['turn-restrictions.json', 'restrictions']
]);
// A network is one reviewed document with no edit operations. It is read as a single record, so its stops and patterns
// stay together and the read-only rules of version 5 can inspect it like any other source.
const networkFile = 'transit-network.json';

// Returns the file as a FeatureCollection, whatever its format.
export function collectionOf(filename, parsed) {
  if (filename === networkFile) {
    if (parsed?.type === 'FeatureCollection') return parsed;
    return {
      type: 'FeatureCollection',
      entitySchemaVersion: parsed?.version,
      features: [{type: 'Feature', geometry: null, properties: parsed}]
    };
  }
  const listName = recordLists.get(filename);
  if (!listName) return parsed;
  const records = Array.isArray(parsed?.[listName]) ? parsed[listName] : [];
  return {
    type: 'FeatureCollection',
    entitySchemaVersion: parsed?.entitySchemaVersion,
    features: records.map(record => ({type: 'Feature', geometry: null, properties: record}))
  };
}
