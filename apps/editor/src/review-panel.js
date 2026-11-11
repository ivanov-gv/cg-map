import {buildChangeset, importChangeset, materializedLayer} from './changeset.js';
import {labelJoinProblems} from './cross-file-checks.js';
import {createElementWithText, downloadJSON, elementById} from './dom.js';
import {diffProperties, formatValue, geometryChanged, summarizeGeometryChange} from './feature-diff.js';

// Lists pending changes and handles what crosses the browser's boundary: export, import and discarding.
// The panel renders both the wide (two-pane) and narrow (stacked) layouts; CSS media queries control
// which one is visible. This avoids re-rendering on resize.
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
    elementById('review-files').replaceChildren(...changedFiles.map(filename =>
      this.#fileSection(session, filename)
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
    return changeset;
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

  // Called when the user confirms the export dialog. Catches errors and shows them in the dialog.
  async #handleConfirmExport() {
    const author = this.#authorInput.value.trim();
    const reason = this.#reasonInput.value.trim();
    try {
      const result = await this.#exportChangeset(author, reason);
      if (!result) {
        this.#errorElement.textContent = 'Enter an author and a reason before exporting.';
        this.#errorElement.hidden = false;
        return;
      }
      const changeCount = result.operations.length;
      this.#closeDialogAndFocusOpener();
      this.showMessage(
        `Exported ${changeCount} changes. Apply them with make -C data apply-changeset CHANGESET=<absolute path>.`
      );
    } catch (error) {
      this.#errorElement.textContent = error.message;
      this.#errorElement.hidden = false;
    }
  }

  // Close the dialog and return focus to the export button.
  #closeDialogAndFocusOpener() {
    this.#dialog.hidden = true;
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

  #handleEnterKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.#confirmButton.click();
    }
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

    this.#exportButton.onclick = () => {
      this.#dialog.hidden = false;
      this.#errorElement.hidden = true;
      this.#updateConfirmButtonState();
      this.#authorInput.focus();
    };

    this.#confirmButton.onclick = () => this.#handleConfirmExport();
    this.#cancelButton.onclick = () => this.#closeDialogAndFocusOpener();

    this.#authorInput.addEventListener('input', () => this.#updateConfirmButtonState());
    this.#reasonInput.addEventListener('input', () => this.#updateConfirmButtonState());

    this.#authorInput.addEventListener('keydown', (event) => this.#handleEnterKey(event));
    this.#reasonInput.addEventListener('keydown', (event) => this.#handleEnterKey(event));

    // Keep keyboard focus inside the modal until it closes.
    this.#dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const first = this.#authorInput;
      const last = this.#cancelButton;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    // app.js checks the dialog's hidden state before closing panels on Escape.
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !this.#dialog.hidden) {
        event.preventDefault();
        this.#closeDialogAndFocusOpener();
      }
    });

    elementById('discard-changes').onclick = () => this.#discardChanges();
    elementById('import-changeset').onchange = async event => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) await this.#importFile(file);
    };
  }

  // Build a section for one changed file, with both wide and narrow layouts.
  #fileSection(session, filename) {
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
      const button = this.#changeListButton(changes[changeIndex]);
      button.dataset.index = String(changeIndex);
      button.onclick = () => this.#selectChange(twoPane, changes, changeIndex);
      const item = document.createElement('li');
      item.append(button);
      list.append(item);
    }
    listPane.append(list);
    twoPane.append(listPane);

    const detailPane = document.createElement('div');
    detailPane.classList.add('review-detail-pane');
    if (changes.length > 0) {
      detailPane.append(this.#changeDetailView(changes[0]));
      const firstButton = list.querySelector('.change-list-item');
      firstButton.classList.add('change-list-selected');
      firstButton.setAttribute('aria-current', 'true');
    } else {
      detailPane.append(createElementWithText('p', 'Select a change to review.'));
    }
    twoPane.append(detailPane);
    section.append(twoPane);

    // Stacked accordion for narrow screens (hidden on wide via CSS)
    // The `name` attribute makes the accordion exclusive: only one item open at a time.
    const stackedList = document.createElement('ul');
    stackedList.classList.add('review-stacked-list');
    for (const change of changes) {
      stackedList.append(this.#changeAccordionItem(change));
    }
    section.append(stackedList);

    const geojsonButton = createElementWithText('button', `Download ${filename}`);
    geojsonButton.type = 'button';
    geojsonButton.onclick = () => downloadJSON(filename, materializedLayer(session, filename));
    section.append(geojsonButton);
    return section;
  }

  // Create a button for the change list — keyboard accessible with proper role.
  #changeListButton(change) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('change-list-item');
    button.append(createElementWithText('span', this.#changeTarget(change)));
    return button;
  }

  // Build the full comparison view for one change, shown in the detail pane.
  #changeDetailView(change) {
    const container = document.createElement('div');
    container.classList.add('change-detail');
    container.append(createElementWithText('h3', this.#changeTarget(change)));

    container.append(this.#changeComparison(change));
    return container;
  }

  // Build a stacked accordion item for narrow screens.
  #changeAccordionItem(change) {
    const item = document.createElement('li');
    const details = document.createElement('details');
    details.name = 'review-change';
    details.append(createElementWithText('summary', this.#changeTarget(change)));

    details.append(this.#changeComparison(change));

    item.append(details);
    return item;
  }

  // Render the comparison appropriate to the operation in either layout.
  #changeComparison(change) {
    return change.operation === 'modify' ? this.#buildDiffTable(change) : this.#buildSingleView(change);
  }

  #selectChange(twoPane, changes, index) {
    const listItems = twoPane.querySelectorAll('.change-list-item');
    listItems.forEach((listItem, itemIndex) => {
      listItem.classList.toggle('change-list-selected', itemIndex === index);
      listItem.setAttribute('aria-current', itemIndex === index ? 'true' : 'false');
    });

    const detailPane = twoPane.querySelector('.review-detail-pane');
    detailPane.replaceChildren(this.#changeDetailView(changes[index]));
  }

  #changeTarget({operation, reference, before, after}) {
    const {name, 'addr:housenumber': houseNumber} = (after ?? before).properties;
    const target = name || houseNumber || reference.localId || `feature ${reference.featureIndex}`;
    return `${operation} · ${target}`;
  }

  // Create a table row for one or more cell values.
  #createFieldRow(...cells) {
    const row = document.createElement('tr');
    for (const text of cells) row.append(createElementWithText('td', text));
    return row;
  }

  // Create a table header row.
  #createTableHeader(...labels) {
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of labels) headerRow.append(createElementWithText('th', label));
    thead.append(headerRow);
    return thead;
  }

  // Build a comparison table that shows changed fields first, then unchanged ones.
  #buildDiffTable(change) {
    const table = document.createElement('table');
    table.append(this.#createTableHeader('Field', 'Before', 'After'));

    const body = document.createElement('tbody');
    const {changed: changedProperties, unchanged} = diffProperties(
      change.before?.properties,
      change.after?.properties
    );

    for (const key of changedProperties) {
      const row = this.#createFieldRow(
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
      const cell = document.createElement('td');
      cell.colSpan = 2;
      const details = document.createElement('details');
      details.append(createElementWithText('summary', 'Full geometry'));
      details.append(createElementWithText('p', 'Before'));
      details.append(createElementWithText('code', formatValue(change.before?.geometry)));
      details.append(createElementWithText('p', 'After'));
      details.append(createElementWithText('code', formatValue(change.after?.geometry)));
      cell.append(details);
      row.append(cell);
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
        innerBody.append(this.#createFieldRow(
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

  // Build a property table for an added or deleted feature.
  #buildSingleView(change) {
    const table = document.createElement('table');
    table.append(this.#createTableHeader('Field', 'Value'));

    const body = document.createElement('tbody');
    const feature = change.after ?? change.before;
    if (!feature) return table;

    for (const [key, value] of Object.entries(feature.properties)) {
      body.append(this.#createFieldRow(key, formatValue(value)));
    }
    const geometryRow = document.createElement('tr');
    geometryRow.append(createElementWithText('td', 'geometry'));
    const geometryCell = document.createElement('td');
    const geometryDetails = document.createElement('details');
    geometryDetails.append(createElementWithText('summary', feature.geometry?.type ?? 'Geometry'));
    geometryDetails.append(createElementWithText('code', formatValue(feature.geometry)));
    geometryCell.append(geometryDetails);
    geometryRow.append(geometryCell);
    body.append(geometryRow);
    table.append(body);
    return table;
  }
}

// Check whether the export dialog is currently visible.
// app.js uses this to avoid closing the Changes panel while the dialog is open.
export function isExportDialogVisible() {
  const dialog = elementById('export-dialog');
  return dialog && !dialog.hidden;
}
