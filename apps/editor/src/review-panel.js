import {buildChangeset, importChangeset, materializedLayer} from './changeset.js';
import {labelJoinProblems} from './cross-file-checks.js';
import {createElementWithText, downloadJSON, elementById} from './dom.js';

// Compare two property objects and return the fields that differ.
// Uses JSON serialization so that object and array values are compared by value, not by reference.
function diffProperties(beforeProperties, afterProperties) {
  const allKeys = new Set([...Object.keys(beforeProperties ?? {}), ...Object.keys(afterProperties ?? {})]);
  const changed = [];
  const unchanged = [];
  for (const key of [...allKeys].sort()) {
    const beforeValue = beforeProperties?.[key];
    const afterValue = afterProperties?.[key];
    if (formatValue(beforeValue) !== formatValue(afterValue)) changed.push(key);
    else unchanged.push(key);
  }
  return {changed, unchanged};
}

// Return whether the geometry changed between two features.
function geometryChanged(beforeGeometry, afterGeometry) {
  return JSON.stringify(beforeGeometry ?? {}) !== JSON.stringify(afterGeometry ?? {});
}

// Summarize a geometry change for compact display, e.g. "moved" or "vertices: 4 → 5".
function summarizeGeometryChange(beforeGeometry, afterGeometry) {
  if (!beforeGeometry || !afterGeometry) return 'geometry changed';
  const beforeCoords = beforeGeometry.coordinates;
  const afterCoords = afterGeometry.coordinates;
  // Quick check: if the stringified coordinates are identical, nothing changed
  if (JSON.stringify(beforeCoords) === JSON.stringify(afterCoords)) return null;
  // Count vertices before and after
  function countVertices(coords) {
    if (Array.isArray(coords[0]?.[0])) return coords.flat().length; // Multi-polygon or multi-line
    return coords.length;
  }
  const beforeCount = countVertices(beforeCoords);
  const afterCount = countVertices(afterCoords);
  if (beforeCount !== afterCount) return `vertices: ${beforeCount} → ${afterCount}`;
  return 'moved';
}

function changeTarget({operation, reference, before, after}) {
  const {name, 'addr:housenumber': houseNumber} = (after ?? before).properties;
  const target = name || houseNumber || reference.localId || `feature ${reference.featureIndex}`;
  return `${operation} · ${target}`;
}

// Create a table row for one or more cell values.
function createFieldRow(...cells) {
  const row = document.createElement('tr');
  for (const text of cells) row.append(createElementWithText('td', text));
  return row;
}

// Create a table header row.
function createTableHeader(...labels) {
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const label of labels) headerRow.append(createElementWithText('th', label));
  thead.append(headerRow);
  return thead;
}

// Build a comparison table that shows changed fields first, then unchanged ones.
function buildDiffTable(change) {
  const table = document.createElement('table');
  table.append(createTableHeader('Field', 'Before', 'After'));

  const body = document.createElement('tbody');
  const {changed: changedProperties, unchanged} = diffProperties(
    change.before?.properties,
    change.after?.properties
  );

  for (const key of changedProperties) {
    const row = createFieldRow(
      key,
      formatValue(change.before?.properties?.[key]),
      formatValue(change.after?.properties?.[key])
    );
    row.classList.add('diff-changed');
    body.append(row);
  }

  if (geometryChanged(change.before?.geometry, change.after?.geometry)) {
    const summary = summarizeGeometryChange(change.before?.geometry, change.after?.geometry);
    const row = document.createElement('tr');
    row.classList.add('diff-changed');
    const fieldLabel = summary ? `geometry (${summary})` : 'geometry';
    row.append(createElementWithText('td', fieldLabel));
    // Full geometry JSON is shown in monospace for readability.
    const beforeCell = document.createElement('td');
    beforeCell.append(createElementWithText('code', formatValue(change.before?.geometry)));
    const afterCell = document.createElement('td');
    afterCell.append(createElementWithText('code', formatValue(change.after?.geometry)));
    row.append(beforeCell, afterCell);
    body.append(row);
  }

  // Unchanged fields are collapsed so the reviewer sees differences first.
  if (unchanged.length > 0) {
    const wrapper = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    const innerDetails = document.createElement('details');
    innerDetails.append(createElementWithText('summary', `${unchanged.length} unchanged fields`));
    const innerBody = document.createElement('tbody');
    for (const key of unchanged) {
      innerBody.append(createFieldRow(
        key,
        formatValue(change.before?.properties?.[key]),
        formatValue(change.after?.properties?.[key])
      ));
    }
    const innerTable = document.createElement('table');
    innerTable.append(innerBody);
    innerDetails.append(innerTable);
    cell.append(innerDetails);
    wrapper.append(cell);
    body.append(wrapper);
  }

  table.append(body);
  return table;
}

function formatValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

// Build a property table for an added or deleted feature.
function buildSingleView(change) {
  const table = document.createElement('table');
  table.append(createTableHeader('Field', 'Value'));

  const body = document.createElement('tbody');
  const feature = change.after ?? change.before;
  if (!feature) return table;

  for (const [key, value] of Object.entries(feature.properties)) {
    body.append(createFieldRow(key, formatValue(value)));
  }
  body.append(createFieldRow('geometry', formatValue(feature.geometry)));
  table.append(body);
  return table;
}

// Build a list item for one change; the item is used in the change list on wide screens.
function changeListItem(change) {
  const item = document.createElement('li');
  item.classList.add('change-list-item');
  item.append(createElementWithText('span', changeTarget(change)));
  return item;
}

// Build the full comparison view for one change, shown in the detail pane on wide screens.
function changeDetailView(change) {
  const container = document.createElement('div');
  container.classList.add('change-detail');
  container.append(createElementWithText('h3', changeTarget(change)));

  if (change.operation === 'modify') {
    container.append(buildDiffTable(change));
  } else {
    container.append(buildSingleView(change));
  }

  return container;
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

// Build a section that shows a two-pane list+detail view on wide screens
// and a stacked accordion on narrow screens. CSS controls which layout is visible.
function fileSectionWithDetailPane(session, filename) {
  const section = document.createElement('section');
  section.dataset.changedFile = filename;
  const changes = session.changes(filename);
  const changeWord = changes.length === 1 ? 'change' : 'changes';
  section.append(createElementWithText('h3', `${filename} · ${changes.length} ${changeWord}`));

  // Two-pane layout for wide screens (hidden on narrow via CSS)
  const twoPane = document.createElement('div');
  twoPane.classList.add('review-two-pane');

  const listPane = document.createElement('div');
  listPane.classList.add('review-list-pane');
  const list = document.createElement('ul');
  list.classList.add('change-list');
  for (let changeIndex = 0; changeIndex < changes.length; changeIndex++) {
    const listItem = changeListItem(changes[changeIndex]);
    listItem.tabIndex = 0;
    listItem.dataset.index = String(changeIndex);
    listItem.onclick = () => selectChange(twoPane, changes, changeIndex);
    list.append(listItem);
  }
  listPane.append(list);
  twoPane.append(listPane);

  const detailPane = document.createElement('div');
  detailPane.classList.add('review-detail-pane');
  if (changes.length > 0) {
    detailPane.append(changeDetailView(changes[0]));
    list.children[0].classList.add('change-list-selected');
  } else {
    detailPane.append(createElementWithText('p', 'Select a change to review.'));
  }
  twoPane.append(detailPane);
  section.append(twoPane);

  // Stacked accordion for narrow screens (hidden on wide via CSS)
  const stackedList = document.createElement('ul');
  stackedList.classList.add('review-stacked-list');
  stackedList.append(...changes.map(changeItem));
  section.append(stackedList);

  const geojsonButton = createElementWithText('button', `Download ${filename}`);
  geojsonButton.type = 'button';
  geojsonButton.onclick = () => downloadJSON(filename, materializedLayer(session, filename));
  section.append(geojsonButton);
  return section;
}

function selectChange(twoPane, changes, index) {
  const listItems = twoPane.querySelectorAll('.change-list-item');
  listItems.forEach(item => item.classList.remove('change-list-selected'));
  listItems[index].classList.add('change-list-selected');

  const detailPane = twoPane.querySelector('.review-detail-pane');
  detailPane.replaceChildren(changeDetailView(changes[index]));
}

// Track whether the export dialog is open so Escape handling respects it.
let isExportDialogOpen = false;

// Lists pending changes and handles what crosses the browser's boundary: export, import and discarding.
// context: {session, sources, rules, levels, hasOpenEdit(), onChanged()}
export class ReviewPanel {
  #context;
  #exportButton;
  #authorInput;
  #reasonInput;
  #confirmButton;
  #cancelButton;
  #errorElement;
  #dialog;
  #escapeHandler;

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
    // Always render the two-pane structure; CSS hides the detail pane on narrow screens.
    elementById('review-files').replaceChildren(...changedFiles.map(filename =>
      fileSectionWithDetailPane(session, filename)
    ));
    elementById('review-problems').replaceChildren(
      ...problems.map(({filename, message}) => createElementWithText('li', `${filename}: ${message}`))
    );
    const isBlocked = hasOpenEdit();
    elementById('export-changeset').disabled = isBlocked || changedFiles.length === 0 || problems.length > 0;
    elementById('discard-changes').disabled = isBlocked || changedFiles.length === 0;
    elementById('import-changeset').disabled = isBlocked;
  }

  // Build the changeset and trigger the download. Returns an error message on failure.
  async #exportChangeset(author, reason) {
    if (!author || !reason) {
      return 'Enter an author and a reason before exporting.';
    }
    const createdAt = new Date().toISOString();
    const envelope = {id: crypto.randomUUID(), createdAt, author, reason};
    const changeset = await buildChangeset(this.#context.session, this.#context.sources, envelope);
    downloadJSON(`changeset-${createdAt.slice(0, 10)}.json`, changeset);
    return null; // success
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

  // Called when the user confirms the export dialog.
  async #handleConfirmExport() {
    const author = this.#authorInput.value.trim();
    const reason = this.#reasonInput.value.trim();
    const errorMessage = await this.#exportChangeset(author, reason);
    if (errorMessage) {
      this.#errorElement.textContent = errorMessage;
      this.#errorElement.hidden = false;
      return;
    }
    this.#closeDialogAndFocusOpener();
    this.showMessage(
      `Exported changes. Apply them with make -C data apply-changeset CHANGESET=<absolute path>.`
    );
  }

  // Close the dialog and return focus to the export button.
  #closeDialogAndFocusOpener() {
    this.#dialog.hidden = true;
    isExportDialogOpen = false;
    this.#authorInput.value = '';
    this.#reasonInput.value = '';
    this.#errorElement.hidden = true;
    this.#exportButton.focus();
  }

  // Enable the confirm button only when both fields are filled.
  #updateConfirmButtonState() {
    this.#confirmButton.disabled = !(
      this.#authorInput.value.trim() && this.#reasonInput.value.trim()
    );
  }

  registerActions() {
    // Cache DOM references once instead of looking them up on every dialog open.
    this.#exportButton = elementById('export-changeset');
    this.#authorInput = elementById('changeset-author');
    this.#reasonInput = elementById('changeset-reason');
    this.#confirmButton = elementById('confirm-export');
    this.#cancelButton = elementById('cancel-export');
    this.#errorElement = elementById('export-dialog-error');
    this.#dialog = elementById('export-dialog');

    // Open the export dialog; handlers are registered once below.
    this.#exportButton.onclick = () => {
      this.#dialog.hidden = false;
      isExportDialogOpen = true;
      this.#errorElement.hidden = true;
      this.#updateConfirmButtonState();
      this.#authorInput.focus();
    };

    // Confirm button triggers the export.
    this.#confirmButton.onclick = () => this.#handleConfirmExport();

    // Cancel closes the dialog and returns focus.
    this.#cancelButton.onclick = () => this.#closeDialogAndFocusOpener();

    // Enable confirm button when the user types.
    this.#authorInput.addEventListener('input', () => this.#updateConfirmButtonState());
    this.#reasonInput.addEventListener('input', () => this.#updateConfirmButtonState());

    // Enter in either input triggers confirm.
    this.#authorInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#confirmButton.click();
      }
    });
    this.#reasonInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#confirmButton.click();
      }
    });

    // Escape closes the dialog without closing the Changes panel.
    // This handler runs before the app-level Escape handler because it is registered later
    // and calls event.preventDefault() to stop propagation.
    this.#escapeHandler = event => {
      if (event.key === 'Escape' && isExportDialogOpen) {
        event.preventDefault();
        this.#closeDialogAndFocusOpener();
      }
    };
    document.addEventListener('keydown', this.#escapeHandler);

    elementById('discard-changes').onclick = () => this.#discardChanges();
    elementById('import-changeset').onchange = async event => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) await this.#importFile(file);
    };
  }
}

// Expose the dialog open state so app.js can check it before closing panels on Escape.
export function isExportDialogVisible() {
  return isExportDialogOpen;
}
