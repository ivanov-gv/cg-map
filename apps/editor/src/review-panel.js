import {buildChangeset, importChangeset, materializedLayer} from './changeset.js';
import {labelJoinProblems} from './cross-file-checks.js';
import {createElementWithText, downloadJSON, elementById} from './dom.js';

// Compare two property objects and return the fields that differ, sorted with changed first.
function diffProperties(beforeProps, afterProps) {
  const allKeys = new Set([...Object.keys(beforeProps ?? {}), ...Object.keys(afterProps ?? {})]);
  const changed = [];
  const unchanged = [];
  for (const key of [...allKeys].sort()) {
    const beforeVal = beforeProps?.[key];
    const afterVal = afterProps?.[key];
    if (beforeVal !== afterVal) changed.push(key);
    else unchanged.push(key);
  }
  return {changed, unchanged};
}

// Compare two geometry objects and return the paths that differ (e.g. "coordinates.0.0").
function diffGeometry(beforeGeo, afterGeo) {
  const beforeStr = JSON.stringify(beforeGeo ?? {});
  const afterStr = JSON.stringify(afterGeo ?? {});
  return beforeStr !== afterStr ? ['geometry'] : [];
}

function changeTarget({operation, reference, before, after}) {
  const {name, 'addr:housenumber': houseNumber} = (after ?? before).properties;
  const target = name || houseNumber || reference.localId || `feature ${reference.featureIndex}`;
  return `${operation} · ${target}`;
}

// Build a comparison table that shows changed fields first, then unchanged ones.
function buildDiffTable(change) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.append(
    createElementWithText('th', 'Field'),
    createElementWithText('th', 'Before'),
    createElementWithText('th', 'After')
  );
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const {changed: changedProps, unchanged} = diffProperties(change.before?.properties, change.after?.properties);
  const changedGeo = diffGeometry(change.before?.geometry, change.after?.geometry);

  // Changed fields first
  for (const key of changedProps) {
    const row = document.createElement('tr');
    row.classList.add('diff-changed');
    row.append(createElementWithText('td', key));
    row.append(createElementWithText('td', formatValue(change.before?.properties?.[key])));
    row.append(createElementWithText('td', formatValue(change.after?.properties?.[key])));
    tbody.append(row);
  }
  if (changedGeo.length > 0) {
    const row = document.createElement('tr');
    row.classList.add('diff-changed');
    row.append(createElementWithText('td', 'geometry'));
    row.append(createElementWithText('td', JSON.stringify(change.before?.geometry)));
    row.append(createElementWithText('td', JSON.stringify(change.after?.geometry)));
    tbody.append(row);
  }

  // Unchanged fields (collapsed by default)
  if (unchanged.length > 0) {
    const details = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    const innerDetails = document.createElement('details');
    innerDetails.append(createElementWithText('summary', `${unchanged.length} unchanged fields`));
    const innerTable = document.createElement('table');
    const innerBody = document.createElement('tbody');
    for (const key of unchanged) {
      const row = document.createElement('tr');
      row.append(createElementWithText('td', key));
      row.append(createElementWithText('td', formatValue(change.before?.properties?.[key])));
      row.append(createElementWithText('td', formatValue(change.after?.properties?.[key])));
      innerBody.append(row);
    }
    innerTable.append(innerBody);
    innerDetails.append(innerTable);
    cell.append(innerDetails);
    details.append(cell);
    tbody.append(details);
  }

  table.append(tbody);
  return table;
}

function formatValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Build a simple view for added/deleted features (no diff, just the feature).
function buildSingleView(change) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.append(
    createElementWithText('th', 'Field'),
    createElementWithText('th', 'Value')
  );
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  const feature = change.after ?? change.before;
  if (!feature) return table;

  for (const [key, value] of Object.entries(feature.properties)) {
    const row = document.createElement('tr');
    row.append(createElementWithText('td', key));
    row.append(createElementWithText('td', formatValue(value)));
    tbody.append(row);
  }
  const geoRow = document.createElement('tr');
  geoRow.append(createElementWithText('td', 'geometry'));
  geoRow.append(createElementWithText('td', JSON.stringify(feature.geometry)));
  tbody.append(geoRow);
  table.append(tbody);
  return table;
}

function changeItem(change) {
  const item = document.createElement('li');
  const details = document.createElement('details');
  details.append(createElementWithText('summary', changeTarget(change)));

  if (change.operation === 'modify') {
    details.append(buildDiffTable(change));
  } else {
    details.append(buildSingleView(change));
  }

  item.append(details);
  return item;
}

// Changes are listed per file, because each file is reviewed and imported on its own terms.
function fileSection(session, filename) {
  const section = document.createElement('section');
  section.dataset.changedFile = filename;
  const changes = session.changes(filename);
  const changeWord = changes.length === 1 ? 'change' : 'changes';
  section.append(createElementWithText('h3', `${filename} · ${changes.length} ${changeWord}`));
  const list = document.createElement('ul');
  list.append(...changes.map(changeItem));
  const geojsonButton = createElementWithText('button', `Download ${filename}`);
  geojsonButton.type = 'button';
  geojsonButton.onclick = () => downloadJSON(filename, materializedLayer(session, filename));
  section.append(list, geojsonButton);
  return section;
}

function openExportDialog() {
  const dialog = elementById('export-dialog');
  dialog.hidden = false;
  const authorInput = elementById('changeset-author');
  const reasonInput = elementById('changeset-reason');
  const confirmBtn = elementById('confirm-export');
  const errorEl = elementById('export-dialog-error');
  errorEl.hidden = true;

  // Enable confirm when both fields are filled
  function updateConfirm() {
    confirmBtn.disabled = !(authorInput.value.trim() && reasonInput.value.trim());
  }
  authorInput.addEventListener('input', updateConfirm, {once: false});
  reasonInput.addEventListener('input', updateConfirm, {once: false});
  updateConfirm();

  // Focus the author field
  authorInput.focus();

  return {dialog, authorInput, reasonInput, confirmBtn, errorEl};
}

function closeExportDialog({dialog, authorInput, reasonInput}) {
  dialog.hidden = true;
  authorInput.value = '';
  reasonInput.value = '';
  elementById('export-dialog-error').hidden = true;
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

  async #exportChangeset(author, reason) {
    if (!author || !reason) {
      return {ok: false, message: 'Enter an author and a reason before exporting.'};
    }
    const createdAt = new Date().toISOString();
    const envelope = {id: crypto.randomUUID(), createdAt, author, reason};
    const changeset = await buildChangeset(this.#context.session, this.#context.sources, envelope);
    downloadJSON(`changeset-${createdAt.slice(0, 10)}.json`, changeset);
    return {
      ok: true,
      message: `Exported ${changeset.operations.length} changes. Apply them with make -C data apply-changeset CHANGESET=<absolute path>.`
    };
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
    const exportBtn = elementById('export-changeset');

    // Open export dialog
    exportBtn.onclick = () => {
      const {dialog, authorInput, reasonInput, confirmBtn, errorEl} = openExportDialog();
      const cancelBtn = elementById('cancel-export');

      // Handle confirm
      confirmBtn.onclick = async () => {
        const result = await this.#exportChangeset(authorInput.value.trim(), reasonInput.value.trim());
        if (!result.ok) {
          errorEl.textContent = result.message;
          errorEl.hidden = false;
          return;
        }
        closeExportDialog({dialog, authorInput, reasonInput});
        this.showMessage(result.message);
      };

      // Handle cancel
      cancelBtn.onclick = () => closeExportDialog({dialog, authorInput, reasonInput});

      // Handle Enter key in inputs
      const handleEnter = (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          confirmBtn.click();
        }
      };
      authorInput.addEventListener('keydown', handleEnter);
      reasonInput.addEventListener('keydown', handleEnter);

      // Handle Escape to close
      const handleEscape = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeExportDialog({dialog, authorInput, reasonInput});
          document.removeEventListener('keydown', handleEscape);
          exportBtn.focus();
        }
      };
      document.addEventListener('keydown', handleEscape);
    };

    elementById('discard-changes').onclick = () => this.#discardChanges();
    elementById('import-changeset').onchange = async event => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) await this.#importFile(file);
    };
  }
}
