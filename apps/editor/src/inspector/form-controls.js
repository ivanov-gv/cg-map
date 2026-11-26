// Fields someone does not type freely: the street of an address and the opening hours. Each keeps its value in a normal
// form field, so Apply reads it like any other.
import {createElementWithText} from '../shared/dom.js';
import {editOpeningHours} from '../layers/places/opening-hours-dialog.js';
import {interiorPoint} from '../geometry/interior-point.js';
import {chooseStreet} from '../layers/addresses/street-dialog.js';

const roadsFile = 'roads.geojson';

// A read-only field with a button that opens its own control.
function chosenField(name, value, buttonLabel, openControl) {
  const wrapper = document.createElement('span');
  wrapper.className = 'chosen-field';
  const input = document.createElement('input');
  input.name = name;
  input.value = value ?? '';
  input.readOnly = true;
  const button = createElementWithText('button', buttonLabel);
  button.type = 'button';
  button.onclick = () =>
    openControl(input.value, chosen => {
      input.value = chosen;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      button.focus();
    });
  wrapper.append(input, button);
  return wrapper;
}

function positionOf({geometry}) {
  if (geometry?.type === 'Point') return geometry.coordinates;
  if (geometry?.type === 'Polygon') return interiorPoint(geometry.coordinates);
  return null;
}

// Controls by property name, for the object being edited. An older bundle or an object without a place keeps plain text.
export function formControls({feature, context}) {
  const position = positionOf(feature);
  const controls = {
    opening_hours: value => chosenField('opening_hours', value, 'Edit', editOpeningHours)
  };
  if (position) {
    controls['addr:street'] = value =>
      chosenField('addr:street', value, 'Choose', (_current, onChosen) =>
        chooseStreet(context.entriesOf(roadsFile), position, onChosen)
      );
  }
  return controls;
}
