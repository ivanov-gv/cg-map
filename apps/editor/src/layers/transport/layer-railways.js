// Railways: tracks, platforms, halts and stations, in the Transport group beside stops and routes.
import {valueLabel} from '../../inspector/field-catalog.js';
import {createElementWithText} from '../../shared/dom.js';

const railwaysFile = 'railways.geojson';

function renderRailwayExtras(container, {feature}) {
  const {geometry} = feature;
  const drawnAs = geometry?.type === 'Point' ? 'a symbol' : geometry?.type === 'LineString' ? 'a line' : 'an area';
  container.append(createElementWithText('p', `This railway is drawn on the map as ${drawnAs}.`));
  const note = createElementWithText('p', 'Tracks, platforms and stations are drawn by the public map style from this file.');
  note.className = 'hint';
  container.append(note);
}

export const railwayBehaviors = {
  [railwaysFile]: {
    title: ({properties}) => properties.name || valueLabel('kind', properties.kind ?? 'rail'),
    sections: () => [{title: 'Railway', fields: ['name', 'name:en', 'kind', 'gauge', 'ref']}],
    renderExtras: renderRailwayExtras
  }
};
