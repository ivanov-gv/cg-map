// A river link is picked from the waterways of the same surface file, never typed as an upstream identity.
import {createElementWithText} from '../../shared/dom.js';
import {chosenField} from '../../inspector/form-controls.js';
import {objectName} from '../shared/object-names.js';
import {waterLineKinds} from '../shared/surface-edits.js';

const surfaceFile = 'surface.geojson';

const riverIdOf = ({key, feature}) => feature.properties.entityId ?? key;

// A small native dialog with one button per waterway. Nothing is stored until a button is chosen.
export function chooseRiver(entries, currentId, onChosen) {
  const rivers = entries.filter(
    entry =>
      waterLineKinds.includes(entry.feature.properties.kind) && entry.feature.geometry?.type === 'LineString'
  );
  const dialog = document.createElement('dialog');
  dialog.className = 'river-dialog';
  dialog.append(createElementWithText('h2', 'Choose a waterway'));
  for (const entry of rivers) {
    const button = createElementWithText('button', objectName(entry.feature, surfaceFile));
    button.type = 'button';
    button.onclick = () => {
      dialog.close();
      onChosen(riverIdOf(entry));
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

// The form keeps a normal readonly field, so Apply reads the picked identity like any other property.
export function riverField(value, context) {
  return chosenField(
    'riverEntityId',
    value,
    'Choose',
    (_current, onChosen) => chooseRiver(context.entriesOf(surfaceFile), value, onChosen),
    'Clear'
  );
}
