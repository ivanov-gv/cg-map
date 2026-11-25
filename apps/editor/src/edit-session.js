const isLocalKey = key => key.startsWith('local:');
const isSameJSON = (first, second) => JSON.stringify(first) === JSON.stringify(second);

const stepEdits = step => step.edits ?? [step];

// All pending edits, per source file, and the steps that made them. A step can change several files at once, such as a
// border and the municipalities on both sides of it. Each layer has its own history, so a step never reaches outside
// the files of its layer. A feature key is its source array index, or the local ID of a feature added here.
export class EditSession {
  #sources;
  #changesByFile = new Map();
  #historyByName = new Map();
  #fieldItems = new Map();

  constructor(sources) {
    this.#sources = sources;
  }

  #changesOf(filename) {
    if (!this.#changesByFile.has(filename)) this.#changesByFile.set(filename, new Map());
    return this.#changesByFile.get(filename);
  }

  #historyOf(historyName) {
    if (!this.#historyByName.has(historyName)) this.#historyByName.set(historyName, {undo: [], redo: []});
    return this.#historyByName.get(historyName);
  }

  // The source state of a feature, or null for one added in this session.
  baseFeature(filename, key) {
    return isLocalKey(key) ? null : this.#sources.get(filename).collection.features[Number(key)];
  }

  // A feature as it stands now, or null when it was deleted or does not exist.
  workingFeature(filename, key) {
    const change = this.#changesOf(filename).get(key);
    if (change) return change.after;
    return isLocalKey(key) ? null : (this.baseFeature(filename, key) ?? null);
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

  // Records one undoable step of any number of edits. Returns false when every feature already has this state, so that
  // applying an unchanged form leaves no empty history entry.
  recordEdits(historyName, edits) {
    const changed = edits
      .map(({filename, key, after}) => ({
        filename,
        key,
        previous: this.#changesOf(filename).get(key) ?? null,
        next: this.#changeReaching(filename, key, after)
      }))
      .filter(({previous, next}) => !isSameJSON(previous, next));
    if (changed.length === 0) return false;
    for (const {filename, key, next} of changed) this.#writeChange(filename, key, next);
    const history = this.#historyOf(historyName);
    history.undo.push({edits: changed});
    history.redo = [];
    return true;
  }

  // One edit in the history of its own file.
  recordEdit(filename, key, after) {
    return this.recordEdits(filename, [{filename, key, after}]);
  }

  // A step can be taken back only while everything it wrote still stands: another layer may have edited the same object
  // since, and undoing past that would silently drop its edit.
  #canTravel(historyName, stack, expectedState) {
    const step = this.#historyOf(historyName)[stack].at(-1);
    if (!step) return false;
    return stepEdits(step).every(edit => {
      const filename = edit.filename ?? historyName;
      return isSameJSON(this.#changesOf(filename).get(edit.key) ?? null, edit[expectedState]);
    });
  }

  // Moves one step between two history stacks. Returns the edits it wrote, or null when there is nothing to do.
  #travelHistory(historyName, {fromStack, toStack, expectedState, stateToWrite}) {
    if (!this.#canTravel(historyName, fromStack, expectedState)) return null;
    const history = this.#historyOf(historyName);
    const step = history[fromStack].pop();
    for (const edit of stepEdits(step)) {
      this.#writeChange(edit.filename ?? historyName, edit.key, edit[stateToWrite]);
    }
    history[toStack].push(step);
    return stepEdits(step);
  }

  undo(historyName) {
    const travel = {fromStack: 'undo', toStack: 'redo', expectedState: 'next', stateToWrite: 'previous'};
    return this.#travelHistory(historyName, travel);
  }

  redo(historyName) {
    const travel = {fromStack: 'redo', toStack: 'undo', expectedState: 'previous', stateToWrite: 'next'};
    return this.#travelHistory(historyName, travel);
  }

  canUndo(historyName) {
    return this.#canTravel(historyName, 'undo', 'next');
  }

  canRedo(historyName) {
    return this.#canTravel(historyName, 'redo', 'previous');
  }

  isChanged(filename, key) {
    return this.#changesOf(filename).has(key);
  }

  changes(filename) {
    return [...this.#changesOf(filename).values()];
  }

  changedFiles() {
    return [...this.#changesByFile].filter(([, changes]) => changes.size > 0).map(([filename]) => filename);
  }

  changeCount() {
    return [...this.#changesByFile.values()].reduce((count, changes) => count + changes.size, 0);
  }

  // Features as they stand now. Deleted ones are gone and added ones come last, as in the importer's result.
  workingEntries(filename) {
    const changes = this.#changesOf(filename);
    const entries = [];
    this.#sources.get(filename).collection.features.forEach((feature, index) => {
      const change = changes.get(String(index));
      const current = change ? change.after : feature;
      if (current) entries.push({filename, key: String(index), feature: current});
    });
    for (const [key, change] of changes) {
      if (isLocalKey(key)) entries.push({filename, key, feature: change.after});
    }
    return entries;
  }

  // Rough work for the desk: sketches, notes and deletion marks. They travel in the exported file and never become
  // source data.
  fieldItems() {
    return [...this.#fieldItems.values()];
  }

  saveFieldItem(item) {
    this.#fieldItems.set(item.id, item);
  }

  removeFieldItem(id) {
    return this.#fieldItems.delete(id);
  }

  hasChanges() {
    return this.changeCount() > 0 || this.#fieldItems.size > 0;
  }

  // Everything needed to resume after a reload. The base lets a later session detect a changed snapshot.
  exportDraft() {
    const files = {};
    const histories = {};
    const filesInHistory = new Set();
    for (const [historyName, history] of this.#historyByName) {
      const steps = [...history.undo, ...history.redo];
      if (steps.length === 0) continue;
      histories[historyName] = history;
      for (const step of steps) stepEdits(step).forEach(edit => filesInHistory.add(edit.filename ?? historyName));
    }
    for (const [filename, changes] of this.#changesByFile) {
      if (changes.size === 0 && !filesInHistory.has(filename)) continue;
      files[filename] = {base: this.#sources.get(filename).metadata.sha256, changes: [...changes]};
    }
    const fieldItems = this.fieldItems();
    return {version: 1, files, histories, ...(fieldItems.length > 0 ? {fieldItems} : {})};
  }

  // Also reads drafts from before layers had histories of their own, which kept one per file.
  restoreDraft(draft) {
    for (const [filename, {changes, history}] of Object.entries(draft.files)) {
      this.#changesByFile.set(filename, new Map(changes));
      if (history) this.#historyByName.set(filename, history);
    }
    for (const [historyName, history] of Object.entries(draft.histories ?? {})) {
      this.#historyByName.set(historyName, history);
    }
    for (const item of draft.fieldItems ?? []) this.saveFieldItem(item);
  }

  discardAll() {
    this.#changesByFile.clear();
    this.#historyByName.clear();
    this.#fieldItems.clear();
  }
}
