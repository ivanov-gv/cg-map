import {createElementWithText, elementById} from '../../shared/dom.js';
import {formatLength} from '../../geometry/geometry-measures.js';
import {matchingStreets, streetsNear} from './street-choices.js';

const shownStreetCount = 30;

function streetButton({name, distanceMetres}, onChosen) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'related-row';
  button.append(createElementWithText('strong', name), createElementWithText('span', formatLength(distanceMetres)));
  button.onclick = () => onChosen(name);
  return button;
}

// A street is picked, never typed: only names on the Roads layer are offered.
export function chooseStreet(roads, coordinate, onChosen) {
  const dialog = elementById('street-dialog');
  const search = elementById('street-search');
  const streets = streetsNear(roads, coordinate);
  const choose = name => {
    dialog.close();
    onChosen(name);
  };
  const render = () => {
    const matches = matchingStreets(streets, search.value).slice(0, shownStreetCount);
    const emptyNote = createElementWithText('p', 'No such street on the Roads layer.');
    elementById('street-list').replaceChildren(
      ...(matches.length > 0 ? matches.map(street => streetButton(street, choose)) : [emptyNote])
    );
  };
  search.value = '';
  search.oninput = render;
  elementById('street-none').onclick = () => choose('');
  elementById('street-cancel').onclick = () => dialog.close();
  render();
  dialog.showModal();
}
