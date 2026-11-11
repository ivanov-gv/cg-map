import test from 'node:test';
import assert from 'node:assert/strict';
import {ObjectList} from '../src/object-list.js';

// Only native list structure and focus matter here; each test restores the browser globals it replaces.
function listEnvironment(t) {
  const document = {activeElement: null};
  const createElement = tagName => ({
    tagName,
    children: [],
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    contains(element) {
      return this.children.some(child => child === element || child.contains(element));
    },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.tagName === selector) return child;
        const match = child.querySelector(selector);
        if (match) return match;
      }
      return null;
    },
    focus() { document.activeElement = this; }
  });
  const identifiers = ['objects-list', 'objects-status', 'objects-heading', 'objects-pages',
    'objects-previous', 'objects-next'];
  const elements = new Map(identifiers.map(identifier => [identifier, createElement('div')]));
  document.createElement = createElement;
  document.getElementById = identifier => elements.get(identifier);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, value: document});
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  return {document, elements, createElement};
}

const entries = [{key: '7', feature: {
  type: 'Feature', properties: {name: 'Library'}, geometry: {type: 'Point', coordinates: [19.2, 42.4]}
}}];

test('opening during loading transfers focus from status to the first available object', t => {
  const {document, elements} = listEnvironment(t);
  const selected = [];
  const list = new ObjectList(entry => selected.push(entry));
  list.render([], 'Objects in view', 'Loading objects…');
  list.focusFirst();
  assert.equal(document.activeElement, elements.get('objects-status'));
  list.render(entries, 'Objects in view', '');
  const button = elements.get('objects-list').querySelector('button');
  assert.equal(document.activeElement, button);
  assert.equal(button.textContent, 'Library · Point · feature 7');
  button.onclick();
  assert.deepEqual(selected, entries);
});

test('a completed load does not steal focus after the user leaves the list', t => {
  const {document, elements, createElement} = listEnvironment(t);
  const list = new ObjectList(() => {});
  list.render([], 'Objects in view', 'Loading objects…');
  list.focusFirst();
  const otherControl = createElement('button');
  otherControl.focus();
  list.render(entries, 'Objects in view', '');
  assert.equal(document.activeElement, otherControl);
  const button = elements.get('objects-list').querySelector('button');
  button.focus();
  list.render(entries, 'Objects in view', '');
  assert.equal(elements.get('objects-list').querySelector('button'), button);
  assert.equal(document.activeElement, button);
});

test('a changed view preserves list focus on a current object instead of a detached row', t => {
  const {document, elements} = listEnvironment(t);
  const list = new ObjectList(() => {});
  list.render(entries, 'Objects in view', '');
  list.focusFirst();
  const previousButton = document.activeElement;
  list.render([{...entries[0], key: '8'}], 'Objects in view', '');
  assert.notEqual(document.activeElement, previousButton);
  assert.equal(document.activeElement, elements.get('objects-list').querySelector('button'));
  assert.equal(document.activeElement.textContent, 'Library · Point · feature 8');
});
