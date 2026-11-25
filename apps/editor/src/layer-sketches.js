// Rough outlines from the field: what something is and a note, for whoever draws it at the desk. A sketch uses the same
// drawing and form as any object, but it is saved as a field item and never as an edit of a source.
import {createElementWithText} from './dom.js';

// Not a source file: the name under which the form and the drawing tools know a sketch.
export const sketchFile = 'field-sketch';

const whatLayers = new Map([
  ['Building', 'buildings'],
  ['Shop or place', 'places'],
  ['Road or path', 'roads'],
  ['Park', 'green'],
  ['Playground', 'green'],
  ['Sports ground', 'green'],
  ['Parking', 'green'],
  ['Water', 'water'],
  ['Bus stop', 'stops'],
  ['Other', null]
]);

// What a sketch may say. It limits only this editor's own form, so it is no shared contract.
export const sketchRule = {
  operations: ['add', 'modify'],
  geometries: ['Polygon', 'LineString', 'Point'],
  properties: {
    what: {required: true, enum: [...whatLayers.keys()]},
    note: {maxLength: 2000}
  }
};

export const sketchChoices = [
  {label: 'Sketch an area', filename: sketchFile, shape: 'Polygon', properties: {}},
  {label: 'Sketch a line', filename: sketchFile, shape: 'LineString', properties: {}}
];

// The layer the desk finishes a sketch on, or the one it was drawn on when its kind does not say.
export const layerForSketch = (what, currentLayerId) => whatLayers.get(what) ?? currentLayerId;

function noteControl(value) {
  const field = document.createElement('textarea');
  field.name = 'note';
  field.rows = 3;
  field.maxLength = sketchRule.properties.note.maxLength;
  field.value = value ?? '';
  return field;
}

export const sketchBehaviors = {
  [sketchFile]: {
    kind: () => 'Sketch',
    title: ({properties}) => properties.what ?? 'New sketch',
    hasMagnet: () => false,
    sections: () => [{title: 'What is it', fields: ['what', 'note']}],
    controls: () => ({note: noteControl}),
    renderExtras(container) {
      const hint = createElementWithText('p', 'The final shape is drawn at the desk. A rough outline is enough here.');
      hint.className = 'hint';
      container.append(hint);
    },
    applyLabel: () => 'Save sketch',
    record: ({key, feature}, context) =>
      context.saveSketch({
        id: key,
        type: 'sketch',
        createdAt: new Date().toISOString(),
        what: feature.properties.what,
        ...(feature.properties.note ? {note: feature.properties.note} : {}),
        geometry: feature.geometry
      })
  }
};
