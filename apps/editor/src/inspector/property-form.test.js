import test from 'node:test';
import assert from 'node:assert/strict';
import {propertiesFromForm, renderPropertyForm} from './property-form.js';
import {isTyped, usualValuesOf} from './usual-values.js';

// Only the fields a form renders matter here: a small element tree tells a list from a text field without a browser.
function formEnvironment(t) {
  const createElement = tagName => {
    const children = [];
    const attributes = new Map();
    return {
      tagName,
      children,
      dataset: {},
      hidden: false,
      value: '',
      textContent: '',
      get firstChild() {
        return children[0];
      },
      get options() {
        return children.filter(child => child.tagName === 'option');
      },
      append(...elements) {
        children.push(...elements);
      },
      replaceChildren(...elements) {
        children.splice(0, children.length, ...elements);
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      focus() {},
      dispatchEvent() {}
    };
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {configurable: true, value: {createElement}});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return createElement;
}

function descendants(element) {
  return element.children.flatMap(child => [child, ...descendants(child)]);
}

const listFor = (form, name) =>
  descendants(form).find(element => element.tagName === 'select' && element.dataset.listFor === name);

const textFields = (form, name) =>
  descendants(form).filter(element => element.tagName === 'input' && element.name === name);

const visibleTextField = (form, name) => textFields(form, name).find(element => !element.hidden);

const entrance = {feature: {properties: {ref: '1'}, geometry: {type: 'Point', coordinates: [19.25, 42.44]}}};
const road = {
  feature: {
    properties: {ref: 'M-2'},
    geometry: {type: 'LineString', coordinates: [[19.25, 42.44], [19.26, 42.44]]}
  }
};
const refRule = {maxLength: 128};

function renderRefForm(createElement, filename, entry) {
  const form = createElement('form');
  const context = {entriesOf: () => [entry]};
  renderPropertyForm(form, entry.feature.properties, {ref: refRule}, [], {
    usualValues: usualValuesOf(filename, entry.feature, context)
  });
  return form;
}

test('an entrance number is typed, while a road number still offers the numbers roads use', t => {
  const createElement = formEnvironment(t);
  const entranceForm = renderRefForm(createElement, 'building-entrances.geojson', entrance);
  const roadForm = renderRefForm(createElement, 'roads.geojson', road);

  assert.equal(listFor(entranceForm, 'ref'), undefined);
  assert.equal(visibleTextField(entranceForm, 'ref')?.value, '1');
  assert.equal(isTyped('building-entrances.geojson', 'ref'), true);
  assert.equal(isTyped('roads.geojson', 'ref'), false);

  const roadNumbers = listFor(roadForm, 'ref');
  assert.ok(roadNumbers, 'a road still offers a list');
  assert.ok(roadNumbers.options.some(option => option.value === 'M-2'));
});

test('a typed entrance number such as 2a survives the form as text', t => {
  const createElement = formEnvironment(t);
  const form = renderRefForm(createElement, 'building-entrances.geojson', entrance);
  const input = visibleTextField(form, 'ref');
  assert.ok(input, 'the number can be typed straight into the form');
  input.value = '2a';
  // A usual-values list hides its input, so only a visible text field stands for what someone typed.
  const typedValues = Object.fromEntries(
    textFields(form, 'ref').filter(field => !field.hidden).map(field => [field.name, field.value])
  );
  assert.deepEqual(propertiesFromForm(entrance.feature.properties, typedValues, {ref: refRule}), {ref: '2a'});
});
