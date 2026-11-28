// A river link is picked from the waterways of the same surface file, never typed as an upstream identity.
import {chosenField} from '../../inspector/form-controls.js';
import {openEntityPickerDialog} from '../shared/entity-picker.js';
import {objectName} from '../shared/object-names.js';
import {waterLineKinds} from '../shared/surface-edits.js';

const surfaceFile = 'surface.geojson';

const riverIdOf = ({key, feature}) => feature.properties.entityId ?? key;

// A small native dialog with one button per waterway. Nothing is stored until a button is chosen.
export function chooseRiver(entries, _currentId, onChosen) {
  const rivers = entries.filter(
    entry =>
      waterLineKinds.includes(entry.feature.properties.kind) && entry.feature.geometry?.type === 'LineString'
  );
  openEntityPickerDialog(
    'Choose a waterway',
    rivers.map(entry => ({label: objectName(entry.feature, surfaceFile), value: riverIdOf(entry)})),
    onChosen
  );
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
