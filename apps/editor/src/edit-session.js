const isLocalKey = key => key.startsWith('local:');
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

// All pending edits, per source file. History is per file too, so a step can only ever change one file.
// A feature key is its source array index, or the local ID of a feature added here.
export class EditSession {
  #sources;
  #changesByFile = new Map();
  #historyByFile = new Map();

  constructor(sources) {
    this.#sources = sources;
  }

  #changesOf(filename) {
    if (!this.#changesByFile.has(filename)) this.#changesByFile.set(filename, new Map());
    return this.#changesByFile.get(filename);
  }

  #historyOf(filename) {
    if (!this.#historyByFile.has(filename)) this.#historyByFile.set(filename, {undo: [], redo: []});
    return this.#historyByFile.get(filename);
  }

  // The source state of a feature, or null for one added in this session.
  baseFeature(filename, key) {
    return isLocalKey(key) ? null : this.#sources.get(filename).collection.features[Number(key)];
  }

  // The change that takes a feature from its source state to this one, or null when they are the same.
  #changeReaching(filename, key, after) {
    if (isLocalKey(key)) return after ? {operation: 'add', reference: {localId: key}, before: null, after} : null;
    const before = this.baseFeature(filename, key);
    const reference = {featureIndex: Number(key)};
    if (!after) return {operation: 'delete', reference, before, after: null};
    return isSameJSON(before, after) ? null : {operation: 'modify', reference, before, after};
  }

  #writeChange(filename, key, change) {
    if (change) this.#changesOf(filename).set(key, change);
    else this.#changesOf(filename).delete(key);
  }

  // Records one undoable step. Returns false when the feature already has this state, so that applying an
  // unchanged form leaves no empty history entry.
  recordEdit(filename, key, after) {
    const previous = this.#changesOf(filename).get(key) ?? null;
    const next = this.#changeReaching(filename, key, after);
    if (isSameJSON(previous, next)) return false;
    this.#writeChange(filename, key, next);
    const history = this.#historyOf(filename);
    history.undo.push({key, previous, next});
    history.redo = [];
    return true;
  }

  // Moves one step between two history stacks. Returns the key it changed, or null when there is nothing to do.
  #travelHistory(filename, fromStack, toStack, stateToWrite) {
    const history = this.#historyOf(filename);
    const step = history[fromStack].pop();
    if (!step) return null;
    this.#writeChange(filename, step.key, step[stateToWrite]);
    history[toStack].push(step);
    return step.key;
  }

  undo(filename) {
    return this.#travelHistory(filename, 'undo', 'redo', 'previous');
  }

  redo(filename) {
    return this.#travelHistory(filename, 'redo', 'undo', 'next');
  }

  canUndo(filename) {
    return this.#historyOf(filename).undo.length > 0;
  }

  canRedo(filename) {
    return this.#historyOf(filename).redo.length > 0;
  }

  changes(filename) {
    return [...this.#changesOf(filename).values()];
  }

  changedFiles() {
    return [...this.#changesByFile].filter(([, changes]) => changes.size > 0).map(([filename]) => filename);
  }

  // Features as they stand now. Deleted ones are gone and added ones come last, as in the importer's result.
  workingEntries(filename) {
    const changes = this.#changesOf(filename);
    const entries = [];
    this.#sources.get(filename).collection.features.forEach((feature, index) => {
      const change = changes.get(String(index));
      const current = change ? change.after : feature;
      if (current) entries.push({key: String(index), feature: current});
    });
    for (const [key, change] of changes) {
      if (isLocalKey(key)) entries.push({key, feature: change.after});
    }
    return entries;
  }

  // Everything needed to resume after a reload. The base lets a later session detect a changed snapshot.
  exportDraft() {
    const files = {};
    for (const [filename, history] of this.#historyByFile) {
      const hasContent = history.undo.length > 0 || history.redo.length > 0 || this.#changesOf(filename).size > 0;
      if (!hasContent) continue;
      const base = this.#sources.get(filename).metadata.sha256;
      files[filename] = {base, changes: [...this.#changesOf(filename)], history};
    }
    return {version: 1, files};
  }

  restoreDraft(draft) {
    for (const [filename, {changes, history}] of Object.entries(draft.files)) {
      this.#changesByFile.set(filename, new Map(changes));
      this.#historyByFile.set(filename, history);
    }
  }

  discardAll() {
    this.#changesByFile.clear();
    this.#historyByFile.clear();
  }
}
