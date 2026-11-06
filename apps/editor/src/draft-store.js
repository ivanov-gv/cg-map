// Keeps the working draft across reloads. Storage can be full or blocked, so failures reach the caller
// and the editor shows them rather than letting someone believe work is saved.
const draftStorageKey = 'kompas-editor-draft-v1';
// A draft this session cannot use moves here, out of reach of autosave, until someone downloads or discards it.
const setAsideStorageKey = 'kompas-editor-set-aside-drafts-v1';

export function saveDraft(storage, draft) {
  const hasContent = Object.keys(draft.files).length > 0;
  if (hasContent) storage.setItem(draftStorageKey, JSON.stringify(draft));
  else storage.removeItem(draftStorageKey);
}

// Why this saved text cannot be resumed on these sources, or null. A draft from another snapshot refers by index to
// features that may now be different ones.
function draftUnusableReason(draft, sources) {
  if (draft?.version !== 1 || !draft.files) return 'it has an unsupported format';
  const conflicts = Object.entries(draft.files)
    .filter(([filename, {base}]) => sources.get(filename)?.metadata.sha256 !== base)
    .map(([filename]) => filename);
  return conflicts.length > 0 ? `it was made on a different version of ${conflicts.join(', ')}` : null;
}

function parsedOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const readSetAsideDrafts = storage => parsedOrNull(storage.getItem(setAsideStorageKey)) ?? [];

export const clearSetAsideDrafts = storage => storage.removeItem(setAsideStorageKey);

export const readSavedDraftText = storage => storage.getItem(draftStorageKey);

export const removeSavedDraft = storage => storage.removeItem(draftStorageKey);

// Returns the draft to resume, or null. A saved draft that cannot be resumed is set aside first, so the next
// autosave cannot overwrite it. Keeps the raw text, because an unreadable draft may still be recoverable by hand.
export function openSavedDraft(storage, sources) {
  const text = storage.getItem(draftStorageKey);
  if (!text) return null;
  const draft = parsedOrNull(text);
  const reason = draft === null ? 'it is not readable' : draftUnusableReason(draft, sources);
  if (!reason) return draft;
  storage.setItem(setAsideStorageKey, JSON.stringify([...readSetAsideDrafts(storage), {reason, text}]));
  storage.removeItem(draftStorageKey);
  return null;
}
