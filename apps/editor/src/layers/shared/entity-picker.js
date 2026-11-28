import {createElementWithText} from '../../shared/dom.js';

// A small native dialog with one button per choice. Nothing is stored until a button is chosen.
export function openEntityPickerDialog(title, options, onChosen) {
  const dialog = document.createElement('dialog');
  dialog.className = 'river-dialog';
  dialog.append(createElementWithText('h2', title));
  for (const option of options) {
    const button = createElementWithText('button', option.label);
    button.type = 'button';
    button.onclick = () => {
      dialog.close();
      onChosen(option.value);
    };
    dialog.append(button);
  }
  const cancel = createElementWithText('button', 'Cancel');
  cancel.type = 'button';
  cancel.onclick = () => dialog.close();
  dialog.append(cancel);
  dialog.addEventListener('close', () => dialog.remove(), {once: true});
  document.body.append(dialog);
  dialog.showModal();
}
