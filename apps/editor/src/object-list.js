import {createElementWithText, elementById} from './dom.js';
import {objectLabel} from './source-overlay.js';

// Bound DOM work even for country-wide views, while keeping every object reachable by keyboard.
const pageSize = 40;

// Native buttons make each candidate selectable with Tab and Enter/Space, including co-located objects.
export class ObjectList {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.entries = [];
    this.page = 0;
    this.signature = null;
    elementById('objects-previous').onclick = () => this.changePage(-1);
    elementById('objects-next').onclick = () => this.changePage(1);
  }

  // Repeated map idle events must not replace a focused button when the visible objects did not change.
  render(entries, heading, message) {
    const signature = JSON.stringify([heading, message, entries.map(objectLabel)]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.entries = entries;
    this.page = 0;
    elementById('objects-heading').textContent = heading;
    this.message = message;
    this.renderPage();
  }

  changePage(direction) {
    this.page += direction;
    this.renderPage();
    elementById('objects-list').querySelector('button')?.focus();
  }

  // Each page announces its range. No list truncation can hide an otherwise selectable object.
  renderPage() {
    const start = this.page * pageSize;
    const entries = this.entries.slice(start, start + pageSize);
    const list = elementById('objects-list');
    list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement('li');
      const button = createElementWithText('button', objectLabel(entry));
      button.type = 'button';
      button.onclick = () => this.onSelect(entry);
      row.append(button);
      list.append(row);
    }
    const end = start + entries.length;
    elementById('objects-status').textContent = this.message ||
      (this.entries.length ? `${start + 1}–${end} of ${this.entries.length} objects` : 'No objects in the current view.');
    elementById('objects-previous').disabled = this.page === 0;
    elementById('objects-next').disabled = end >= this.entries.length;
    elementById('objects-pages').hidden = this.entries.length <= pageSize;
  }
}
