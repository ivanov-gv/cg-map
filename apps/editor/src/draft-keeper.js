import {downloadJSON, elementById} from './dom.js';
import {
  clearSetAsideDrafts,
  openSavedDraft,
  readSavedDraftText,
  readSetAsideDrafts,
  removeSavedDraft,
  saveDraft
} from './draft-store.js';

// Keeps the pending work across reloads and says so when it cannot.
// context: {session, sources, showError(error), clearError(), onRestored(), onSettled()}
export class DraftKeeper {
  #context;
  #isSavingBlocked = false;
  #isSaveFailing = false;
  #isProblemShown = false;

  constructor(context) {
    this.#context = context;
  }

  hasOnlyInMemoryChanges() {
    const isUnsaved = this.#isSaveFailing || this.#isSavingBlocked;
    return isUnsaved && this.#context.session.hasChanges();
  }

  // Another error took the place of a draft problem, so a later successful save must not clear it.
  forgetShownProblem() {
    this.#isProblemShown = false;
  }

  // A draft problem can clear itself once a save succeeds. Any other error stays on screen.
  #showProblem(message) {
    this.#context.showError(new Error(message));
    this.#isProblemShown = true;
  }

  #clearProblem() {
    if (!this.#isProblemShown) return;
    this.#isProblemShown = false;
    this.#context.clearError();
  }

  // Saving can fail when storage is full or blocked. Say so, because the editor believes the work is safe otherwise.
  persist() {
    if (this.#isSavingBlocked) return;
    try {
      saveDraft(localStorage, this.#context.session.exportDraft());
      this.#isSaveFailing = false;
      this.#clearProblem();
    } catch (error) {
      this.#isSaveFailing = true;
      this.#showProblem(`Draft not saved: ${error.message}. Export your changes before leaving.`);
    }
  }

  // Shows drafts that could not be resumed. They stay in their own storage slot until someone decides. A draft that could
  // not even be moved there is offered too, because it blocks autosave until someone does.
  #offerSetAside() {
    const blockingDraft = this.#isSavingBlocked
      ? [{reason: 'it could not be set aside', text: readSavedDraftText(localStorage)}]
      : [];
    const drafts = [...readSetAsideDrafts(localStorage), ...blockingDraft];
    elementById('draft-conflict').hidden = drafts.length === 0;
    elementById('draft-notice').hidden = drafts.length === 0;
    elementById('draft-conflict-actions').hidden = drafts.length === 0;
    if (drafts.length === 0) return;
    const reasons = drafts.map(({reason}) => reason).join('; ');
    elementById('draft-conflict').textContent = `A saved draft was not applied: ${reasons}.`;
    elementById('draft-download').onclick = () => downloadJSON('editor-set-aside-drafts.json', drafts);
    elementById('draft-discard').onclick = () => this.#discardSetAside();
  }

  // This can be the only copy, so it asks first. Then it saves right away: edits applied while autosave was off, or while
  // storage was full, exist nowhere else, and a reload would lose them.
  #discardSetAside() {
    if (!confirm('Discard the old draft? It cannot be recovered unless you downloaded it.')) return;
    clearSetAsideDrafts(localStorage);
    if (this.#isSavingBlocked) removeSavedDraft(localStorage);
    this.#isSavingBlocked = false;
    this.#offerSetAside();
    this.persist();
    this.#context.onSettled();
  }

  // A broken or blocked saved draft must not stop the editor from opening. If it could not be moved aside, autosave
  // stays off, because the next save would overwrite the only copy.
  restore() {
    try {
      const draft = openSavedDraft(localStorage, this.#context.sources);
      if (draft) {
        this.#context.session.restoreDraft(draft);
        this.#context.onRestored();
      }
    } catch (error) {
      this.#isSavingBlocked = true;
      this.#showProblem(`Saved draft not restored, and new changes will not be saved: ${error.message}`);
    }
    try {
      this.#offerSetAside();
    } catch (error) {
      this.#context.showError(new Error(`Saved drafts cannot be read: ${error.message}`));
    }
  }
}
