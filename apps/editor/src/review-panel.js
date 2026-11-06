import {buildChangeset, importChangeset, materializedLayer} from './changeset.js';
import {labelJoinProblems} from './cross-file-checks.js';
import {createElementWithText, downloadJSON, elementById} from './dom.js';

function changeTitle({operation, reference, before, after}) {
  const {name, 'addr:housenumber': houseNumber} = (after ?? before).properties;
  const target = name || houseNumber || reference.localId || `feature ${reference.featureIndex}`;
  return `${operation} · ${target}`;
}

function changeItem(change) {
  const item = document.createElement('li');
  const details = document.createElement('details');
  details.append(createElementWithText('summary', changeTitle(change)));
  details.append(
    createElementWithText('h3', 'Before'),
    createElementWithText('pre', JSON.stringify(change.before, null, 1))
  );
  details.append(
    createElementWithText('h3', 'After'),
    createElementWithText('pre', JSON.stringify(change.after, null, 1))
  );
  item.append(details);
  return item;
}

// Changes are listed per file, because each file is reviewed and imported on its own terms.
function fileSection(session, filename) {
  const section = document.createElement('section');
  section.dataset.changedFile = filename;
  const changes = session.changes(filename);
  section.append(createElementWithText('h3', `${filename} · ${changes.length}`));
  const list = document.createElement('ul');
  list.append(...changes.map(changeItem));
  const geojsonButton = createElementWithText('button', `Download ${filename}`);
  geojsonButton.type = 'button';
  geojsonButton.onclick = () => downloadJSON(filename, materializedLayer(session, filename));
  section.append(list, geojsonButton);
  return section;
}

// Lists pending changes and handles what crosses the browser's boundary: export, import and discarding.
// context: {session, sources, rules, levels, hasOpenEdit(), onChanged()}
export class ReviewPanel {
  #context;

  constructor(context) {
    this.#context = context;
  }

  showMessage(message) {
    elementById('review-message').textContent = message ?? '';
    elementById('review-message').hidden = !message;
  }

  // An open edit blocks all three: the export would omit it, and the other two would replace it.
  render() {
    const {session, hasOpenEdit} = this.#context;
    const changedFiles = session.changedFiles();
    const problems = labelJoinProblems(session);
    elementById('review-empty').hidden = changedFiles.length > 0;
    elementById('review-files').replaceChildren(...changedFiles.map(filename => fileSection(session, filename)));
    elementById('review-problems').replaceChildren(
      ...problems.map(({filename, message}) => createElementWithText('li', `${filename}: ${message}`))
    );
    const isBlocked = hasOpenEdit();
    elementById('export-changeset').disabled = isBlocked || changedFiles.length === 0 || problems.length > 0;
    elementById('discard-changes').disabled = isBlocked || changedFiles.length === 0;
    elementById('import-changeset').disabled = isBlocked;
  }

  async #exportChangeset() {
    const author = elementById('changeset-author').value.trim();
    const reason = elementById('changeset-reason').value.trim();
    if (!author || !reason) {
      this.showMessage('Enter an author and a reason before exporting.');
      return;
    }
    const createdAt = new Date().toISOString();
    const envelope = {id: crypto.randomUUID(), createdAt, author, reason};
    const changeset = await buildChangeset(this.#context.session, this.#context.sources, envelope);
    downloadJSON(`changeset-${createdAt.slice(0, 10)}.json`, changeset);
    this.showMessage(
      `Exported ${changeset.operations.length} changes. Apply them with make -C data apply-changeset CHANGESET=<absolute path>.`
    );
  }

  async #importFile(file) {
    const {session, sources, rules, levels, onChanged} = this.#context;
    try {
      const changeset = JSON.parse(await file.text());
      await importChangeset(changeset, session, sources, rules, levels);
      this.showMessage(`Imported ${changeset.operations.length} changes from ${file.name}.`);
      onChanged();
    } catch (error) {
      this.showMessage(error.message);
    }
  }

  #discardChanges() {
    // Discarding clears the undo history too, so it asks first.
    if (!confirm('Discard every pending change, including its undo history?')) return;
    this.#context.session.discardAll();
    this.showMessage('Discarded all changes.');
    this.#context.onChanged();
  }

  registerActions() {
    elementById('export-changeset').onclick = () => {
      this.#exportChangeset().catch(error => this.showMessage(error.message));
    };
    elementById('discard-changes').onclick = () => this.#discardChanges();
    elementById('import-changeset').onchange = async event => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) await this.#importFile(file);
    };
  }
}
