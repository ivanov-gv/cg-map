import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {valueLabel} from '../src/field-catalog.js';
import {hasClosedList, isFormField} from '../src/property-form.js';
import {byFrequency, hasUsualValues, isTyped, lineColours, usualValuesOf} from '../src/usual-values.js';

const rules = JSON.parse(fs.readFileSync(new URL('fixtures/editor-layers.json', import.meta.url), 'utf8'));

// Fields with a control of their own, by layer.
const ownControls = {
  'places.geojson': ['kind', 'cuisine', 'opening_hours', 'addr:street'],
  'building-entrances.geojson': ['addr:street'],
  'buildings.geojson': ['addr:street'],
  'building-labels.geojson': ['addr:street', 'entrances'],
  // Found by the place, never chosen.
  'settlements.geojson': ['municipality', 'source']
};

test('every property that can be filled in has a list, a control of its own, or a reason to be typed', () => {
  const undecided = Object.entries(rules.layers).flatMap(([filename, {properties = {}}]) =>
    Object.entries(properties)
      .filter(([, rule]) => isFormField(rule) && !hasClosedList(rule))
      .filter(([name]) => !hasUsualValues(filename, name) && !isTyped(filename, name))
      .filter(([name]) => !ownControls[filename]?.includes(name))
      .map(([name]) => `${filename} ${name}`)
  );
  assert.deepEqual(undecided, []);
});

test('a whole number with few possible values is picked', () => {
  const {minzoom, ele} = rules.layers['summits.geojson'].properties;
  assert.ok(hasClosedList(minzoom));
  assert.ok(hasClosedList(rules.layers['contours.geojson'].properties.elevation));
  assert.ok(!hasClosedList(ele));
});

const road = (name, coordinates, ref) => ({
  filename: 'roads.geojson',
  key: name,
  feature: {type: 'Feature', properties: {name, ref}, geometry: {type: 'LineString', coordinates}}
});

test('a road is offered the names of the streets around it and the numbers roads have', () => {
  const here = [19.25, 42.44];
  const near = [here, [19.251, 42.44]];
  const entries = [road('Njegoševa', near, 'M-2'), road('Njegoševa', near), road('Slovenska', near), road('Far', [[19.5, 42.6], [19.51, 42.6]], 'M-1'), road('', near)];
  const feature = {geometry: {type: 'LineString', coordinates: near}};
  const values = usualValuesOf('roads.geojson', feature, {entriesOf: () => entries});
  assert.deepEqual(values.name, ['Njegoševa', 'Slovenska']);
  assert.deepEqual(values.ref, ['M-2', 'M-1']);
  assert.deepEqual(usualValuesOf('roads.geojson', {geometry: null}, {entriesOf: () => entries}).name, []);
});

test('values are offered most common first, and colours by their names', () => {
  assert.deepEqual(byFrequency(['a', 'b', 'b']), ['b', 'a']);
  const {colour} = rules.layers['transit-routes.json'].properties;
  for (const [value, label] of Object.entries(lineColours)) {
    assert.match(value, new RegExp(colour.pattern));
    assert.equal(valueLabel('colour', value), label);
  }
});

test('the offered values are ones the rules allow', () => {
  const context = {entriesOf: () => []};
  for (const filename of Object.keys(rules.layers)) {
    for (const [name, values] of Object.entries(usualValuesOf(filename, {geometry: null}, context))) {
      const {maxLength} = rules.layers[filename].properties[name];
      assert.ok(values.every(value => maxLength === undefined || value.length <= maxLength), `${filename} ${name}`);
    }
  }
});
