import {elementById} from '../shared/dom.js';

// A note for the desk on any object.
export function writeNote(objectName, onSaved) {
  const dialog = elementById('note-dialog');
  const text = elementById('note-text');
  const save = elementById('note-save');
  elementById('note-title').textContent = `Note on ${objectName}`;
  text.value = '';
  save.disabled = true;
  text.oninput = () => {
    save.disabled = text.value.trim() === '';
  };
  elementById('note-cancel').onclick = () => dialog.close();
  save.onclick = () => {
    dialog.close();
    onSaved(text.value.trim());
  };
  dialog.showModal();
}
