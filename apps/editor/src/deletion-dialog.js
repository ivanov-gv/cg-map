import {createElementWithText, elementById} from './dom.js';

function optionElement({label}, index) {
  const option = createElementWithText('label', '');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'deletion-option';
  input.value = String(index);
  input.checked = index === 0;
  option.append(input, ` ${label}`);
  return option;
}

// Asks before removing an object for good. options say what happens to what belongs to it; the chosen one is passed on.
export function confirmDeletion({title, message, options = []}, onConfirmed) {
  const dialog = elementById('delete-dialog');
  elementById('delete-title').textContent = title;
  elementById('delete-message').textContent = message;
  elementById('delete-options').replaceChildren(...options.map(optionElement));
  elementById('delete-confirm').onclick = () => {
    const checked = dialog.querySelector('input[name="deletion-option"]:checked');
    dialog.close();
    onConfirmed(checked ? options[Number(checked.value)] : null);
  };
  elementById('delete-cancel').onclick = () => dialog.close();
  dialog.showModal();
}
