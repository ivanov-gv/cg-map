// Rough work from the field: what it is and how it is listed. Items travel in the exported changeset and wait in
// Changes for the desk. The importer never writes them to a source.
import {editorLayers} from '../layers/shared/editor-layers.js';
import {isValidCoordinate} from '../geometry/geometry-validation.js';
import {kindLabel} from '../layers/shared/object-names.js';

const timeFormat = new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});

const labelByType = {
  deletion: ({target}) => ({
    title: 'Marked for deletion',
    detail: [target && kindLabel(target.filename), target?.name].filter(Boolean).join(' · ')
  }),
  note: ({target, note}) => ({title: `Note on ${target?.name ?? 'the map'}`, detail: note}),
  sketch: ({what, note, createdAt}) => ({
    title: `New · ${what}`,
    detail: ['Sketch', timeFormat.format(new Date(createdAt)), note].filter(Boolean).join(' · ')
  })
};

export const fieldItemLabel = item => labelByType[item.type](item);

// How an object is named outside this session: by its source identity where it has one.
export function referenceTo({key, feature}) {
  const {entityId, entityPart} = feature.properties;
  if (entityId === undefined) return key.startsWith('local:') ? {localId: key} : {featureIndex: Number(key)};
  return entityPart === undefined ? {entityId} : {entityId, entityPart};
}

// Whether this object is the one a reference names.
export function isReferencedObject({key, feature}, reference) {
  const own = referenceTo({key, feature});
  return JSON.stringify(own) === JSON.stringify(reference);
}

export function newDeletionMark(entry, name, layerId) {
  return {
    id: `local:${crypto.randomUUID()}`,
    type: 'deletion',
    createdAt: new Date().toISOString(),
    layer: layerId,
    geometry: entry.feature.geometry,
    target: {filename: entry.filename, reference: referenceTo(entry), name}
  };
}

export function newNote(entry, name, layerId, note) {
  return {...newDeletionMark(entry, name, layerId), type: 'note', note};
}

const longestWhat = 64;
const longestNote = 2000;
const itemTypes = new Set(['sketch', 'note', 'deletion']);

const isCoordinateList = list => Array.isArray(list) && list.length > 0 && list.every(isValidCoordinate);
const isListOf = isWanted => list => Array.isArray(list) && list.length > 0 && list.every(isWanted);
const areCoordinatesOfType = new Map([
  ['Point', isValidCoordinate],
  ['LineString', isCoordinateList],
  ['Polygon', isListOf(isCoordinateList)],
  ['MultiPolygon', isListOf(isListOf(isCoordinateList))]
]);

// Enough to draw it and to move the map there. A rough outline may cross itself.
const isDrawable = geometry => Boolean(areCoordinatesOfType.get(geometry?.type)?.(geometry.coordinates));

const isText = (value, longest) => typeof value === 'string' && value.trim().length > 0 && value.length <= longest;

function targetProblem({filename, reference, name} = {}, filenames) {
  if (!filenames.includes(filename)) return `unknown source file ${filename}`;
  const isNamed = typeof name === 'string' && typeof reference === 'object' && reference !== null;
  return isNamed ? null : 'a field item needs the object it is about';
}

// What each type needs beside the fields of every item.
const problemByType = {
  sketch: ({what, geometry}) => (isText(what, longestWhat) && geometry ? null : 'a sketch needs what it is and a shape'),
  note: ({note, target}, filenames) =>
    isText(note, longestNote) ? targetProblem(target, filenames) : 'a note needs its text',
  deletion: ({target}, filenames) => targetProblem(target, filenames)
};

// Returns why an imported item cannot be shown, or null. The file may come from anywhere, and a broken item would stop the
// editor from drawing.
export function fieldItemProblem(item, filenames) {
  if (typeof item?.id !== 'string' || !item.id.startsWith('local:')) return 'a field item needs a local ID';
  if (!itemTypes.has(item.type)) return `unsupported field item ${item.type}`;
  if (!Number.isFinite(Date.parse(item.createdAt))) return 'a field item needs its time';
  if (!editorLayers.some(({id}) => id === item.layer)) return `unknown layer ${item.layer} of a field item`;
  if (item.geometry && !isDrawable(item.geometry)) return 'a field item has an invalid shape';
  if (item.note !== undefined && !isText(item.note, longestNote)) return 'a field item has an invalid note';
  return problemByType[item.type](item, filenames);
}
