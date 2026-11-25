// Rough work from the field: what it is and how it is listed. Items travel in the exported changeset and wait in
// Changes for the desk. The importer never writes them to a source.
import {kindLabel} from './object-names.js';

const titles = {deletion: 'Marked for deletion'};

function detailOf({target, note}) {
  return [target && kindLabel(target.filename), target?.name, note].filter(Boolean).join(' · ');
}

export const fieldItemLabel = item => ({title: titles[item.type] ?? item.type, detail: detailOf(item)});

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

const itemTypes = new Set(['sketch', 'note', 'deletion']);

// Returns why an imported item cannot be shown, or null.
export function fieldItemProblem(item, filenames) {
  if (!item?.id?.startsWith?.('local:')) return 'a field item needs a local ID';
  if (!itemTypes.has(item.type)) return `unsupported field item ${item.type}`;
  if (!Number.isFinite(Date.parse(item.createdAt))) return 'a field item needs its time';
  if (item.target && !filenames.includes(item.target.filename)) return `unknown source file ${item.target.filename}`;
  return null;
}
