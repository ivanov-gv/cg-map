// Reads and writes every source file the editor can change as one list of features, whatever its format on disk.
// Routes and turn restrictions are not GeoJSON: each record becomes a feature without geometry, so rules, references
// and fingerprints work the same way. The editor wraps them identically (apps/editor/src/source-records.js).
import {serializeSourceCollection} from './source-json.mjs';

const recordLists = new Map([
  ['transit-routes.json', 'routes'],
  ['turn-restrictions.json', 'restrictions']
]);
const stopsFile = 'transport-stops.geojson';

const recordFeature = record => ({type: 'Feature', geometry: null, properties: record});

export const isRecordFile = filename => recordLists.has(filename);

// Returns a FeatureCollection. A record file keeps its other fields, such as its retrieval time, in `envelope`.
export function parseSource(filename, text) {
  const parsed = JSON.parse(text);
  const listName = recordLists.get(filename);
  if (!listName) return parsed;
  const {[listName]: records, ...envelope} = parsed;
  if (!Array.isArray(records)) throw new Error(`${filename}: expected a ${listName} list`);
  return {
    type: 'FeatureCollection',
    entitySchemaVersion: parsed.entitySchemaVersion,
    envelope,
    features: records.map(recordFeature)
  };
}

// One record per line under the file's own envelope, as the pipeline writes it.
function serializeRecords(filename, collection) {
  const listName = recordLists.get(filename);
  const envelope = JSON.stringify(collection.envelope).slice(1, -1);
  const lines = collection.features.map(feature => JSON.stringify(feature.properties));
  return `{${envelope},"${listName}":[\n${lines.join(',\n')}\n]}\n`;
}

// The stop snapshot keeps its own key order and stop order, so one edit stays a one-line diff.
function serializeStops(collection) {
  const lines = collection.features.map(feature => JSON.stringify(feature));
  return `{"entitySchemaVersion":1,"type":"FeatureCollection","features":[\n${lines.join(',\n')}\n]}\n`;
}

// The bytes this collection has on disk. An unchanged collection gives back its file byte for byte.
export function serializeSource(filename, collection) {
  if (isRecordFile(filename)) return serializeRecords(filename, collection);
  if (filename === stopsFile) return serializeStops(collection);
  return serializeSourceCollection(collection);
}
