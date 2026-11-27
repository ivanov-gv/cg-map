// Bridge outlines: one deck under all the roads of a bridge. The roads keep their own bridge tags, so this file only
// owns the shape of the deck.
import {valueLabel} from '../../inspector/field-catalog.js';
import {createElementWithText} from '../../shared/dom.js';

const bridgesFile = 'bridges.geojson';

function renderBridgeExtras(container, {feature}) {
  const {method, sourceRoadIds = []} = feature.properties;
  if (sourceRoadIds.length > 0) {
    const noun = sourceRoadIds.length === 1 ? 'road' : 'roads';
    container.append(createElementWithText('p', `The deck follows ${sourceRoadIds.length} ${noun}. Their bridge tags stay with them.`));
  } else {
    container.append(createElementWithText('p', 'A deck drawn here sits under roads marked as bridges.'));
  }
  const origin = method === 'osm' ? 'Its origin is OpenStreetMap.' : 'It was traced in the editor.';
  const note = createElementWithText('p', origin);
  note.className = 'hint';
  container.append(note);
}

export const bridgeBehaviors = {
  [bridgesFile]: {
    title: ({properties}) => properties.name || valueLabel('kind', properties.kind ?? 'bridge'),
    sections: () => [{title: 'Bridge', fields: ['name', 'name:en', 'kind', 'method']}],
    renderExtras: renderBridgeExtras
  }
};
