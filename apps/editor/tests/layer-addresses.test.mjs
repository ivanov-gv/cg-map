import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {addressBehaviors, buildingsWithoutNumber, nearestGap} from '../src/layer-addresses.js';
import {editorLayers} from '../src/editor-layers.js';
import {behaviorOf, registerBehaviors} from '../src/layer-behaviors.js';
import {buildingAt, placeBehaviors} from '../src/layer-places.js';
import {propertiesFromForm, renderPropertyForm} from '../src/property-form.js';
import {matchingStreets, streetsNear} from '../src/street-choices.js';

const square = (west, size = 0.001) => [
  [west, 42.44],
  [west + size, 42.44],
  [west + size, 42.44 + size],
  [west, 42.44 + size],
  [west, 42.44]
];
const building = (entityId, west, properties = {}, size = 0.001) => ({
  type: 'Feature',
  properties: {kind: 'building', entityId, ...properties},
  geometry: {type: 'Polygon', coordinates: [square(west, size)]}
});
const address = (properties, coordinates = [19.2505, 42.4405]) => ({
  type: 'Feature',
  properties: {kind: 'building', ...properties},
  geometry: {type: 'Point', coordinates}
});
const road = (name, latitude) => ({
  type: 'Feature',
  properties: {kind: 'residential', name},
  geometry: {
    type: 'LineString',
    coordinates: [
      [19.24, latitude],
      [19.26, latitude]
    ]
  }
});

function contextWith(featuresByFile) {
  const entriesOf = filename =>
    (featuresByFile[filename] ?? []).map((feature, index) => ({filename, key: String(index), feature}));
  return {
    entriesOf,
    findEntity: (filename, entityId) => entriesOf(filename).find(({feature}) => feature.properties.entityId === entityId),
    rules: {layers: {'places.geojson': {properties: {buildingEntityId: {}}}}},
    session: {workingFeature: () => null}
  };
}

const behavior = addressBehaviors['building-labels.geojson'];
const testRules = JSON.parse(readFileSync(new URL('fixtures/editor-layers.json', import.meta.url)));
// Contracts HEAD lists display_number until #451; the Addresses form must ignore that rule.
const removedNumberRule = {
  maxLength: 128,
  ignoredCharactersPattern: '[\\s./_-]',
  forbiddenValues: ['', 'bb', 'бб', 'bezbroja', 'безброја', 'na', '?']
};
const addressPropertyRules = {
  ...testRules.layers['building-labels.geojson'].properties,
  display_number: removedNumberRule
};

// Presses a button of the address inspector, which renders into anything that takes children.
async function pressExtra(label, edit) {
  const buttons = [];
  globalThis.document = {
    createElement: () => {
      const element = {append() {}};
      buttons.push(element);
      return element;
    }
  };
  behavior.renderExtras({append() {}}, edit);
  await buttons.find(({textContent}) => textContent === label).onclick();
  delete globalThis.document;
}

// The local document stands in for the browser. Only field names, values and label text matter here.
function addressFormElements(properties) {
  const created = [];
  globalThis.document = {
    createElement: tagName => {
      const element = {
        tagName,
        children: [],
        append(...children) {
          this.children.push(...children);
        }
      };
      created.push(element);
      return element;
    }
  };
  const form = {
    children: [],
    replaceChildren(...children) {
      this.children = children;
    }
  };
  const layer = editorLayers.find(({id}) => id === 'addresses');
  registerBehaviors(addressBehaviors, layer.id);
  try {
    renderPropertyForm(form, properties, addressPropertyRules, new Set(), {
      sections: behaviorOf('building-labels.geojson', layer.id).sections(properties, {}),
      controls: {},
      usualValues: {}
    });
    const descendants = element => [element, ...element.children.flatMap(descendants)];
    return descendants(form).slice(1);
  } finally {
    delete globalThis.document;
  }
}

test('the Addresses form has no display number and Apply records none', () => {
  const properties = {kind: 'building', 'addr:housenumber': '14'};
  const elements = addressFormElements(properties);
  const fields = elements.filter(({name}) => name !== undefined);
  assert.ok(fields.some(({name}) => name === 'addr:housenumber'), 'the Addresses form rendered');
  const formValues = Object.fromEntries(fields.map(({name, value}) => [name, String(value ?? '')]));
  assert.equal(Object.hasOwn(formValues, 'display_number'), false, 'Apply has no display number to record');
  assert.equal(fields.some(({name}) => name === 'display_number'), false);
  assert.equal(elements.some(({textContent}) => textContent === 'Display number'), false);
  const applied = propertiesFromForm(properties, formValues, addressPropertyRules);
  assert.equal(applied.display_number, undefined);
});

test('an address moves with what is typed, and never to a building that has one', async () => {
  const context = contextWith({
    'buildings.geojson': [building('way/1', 19.25), building('way/2', 19.26), building('way/3', 19.27)],
    'building-labels.geojson': [
      address({footprintIndex: 0, 'addr:housenumber': '14'}),
      address({footprintIndex: 1, 'addr:housenumber': '20'})
    ]
  });
  const [label] = context.entriesOf('building-labels.geojson');
  const [, taken, free] = context.entriesOf('buildings.geojson');
  const recorded = {};
  const editOf = target => ({
    context: {...context, pick: async () => target},
    key: label.key,
    feature: label.feature,
    isOpen: () => true,
    typedFeature: () => address({footprintIndex: 0, 'addr:housenumber': '16'}),
    showProblem: message => (recorded.problem = message),
    replaceWith: edits => (recorded.edits = edits)
  });
  await pressExtra('Change building', editOf(taken));
  assert.match(recorded.problem, /already has an address/);
  assert.equal(recorded.edits, undefined);
  await pressExtra('Change building', editOf(free));
  assert.equal(recorded.edits[1].after.properties['addr:housenumber'], '16');
  assert.equal(recorded.edits[1].after.properties.buildingEntityId, 'way/3');
});

test('an address edit keeps its building in step, and nothing else of the building changes', () => {
  const context = contextWith({'buildings.geojson': [building('way/1', 19.25, {nohousenumber: 'yes', name: 'Hall'})]});
  const before = address({footprintIndex: 0, 'addr:housenumber': '14'});
  const after = address({footprintIndex: 0, 'addr:housenumber': '16', 'addr:street': 'Main street'});
  const [edit] = behavior.companionEdits({feature: after, before}, context);
  assert.deepEqual(edit.after.properties, {
    kind: 'building',
    entityId: 'way/1',
    name: 'Hall',
    'addr:housenumber': '16',
    'addr:street': 'Main street'
  });
  assert.deepEqual(behavior.companionEdits({feature: before, before}, context), []);
});

test('a dragged address stops at the wall of its building', () => {
  const context = contextWith({'buildings.geojson': [building('way/1', 19.25)]});
  const feature = address({footprintIndex: 0});
  const inside = {type: 'Point', coordinates: [19.2509, 42.4409]};
  const outside = {type: 'Point', coordinates: [19.252, 42.4409]};
  const edit = {feature, previousGeometry: feature.geometry};
  assert.equal(behavior.limitedGeometry(inside, edit, context), inside);
  assert.equal(behavior.limitedGeometry(outside, edit, context), feature.geometry);
});

test('only buildings whose number is unknown are gaps, and the nearest comes next', () => {
  const context = contextWith({
    'buildings.geojson': [
      building('way/1', 19.25),
      building('way/2', 19.26, {'addr:housenumber': '2'}),
      building('way/3', 19.27, {nohousenumber: 'yes'}),
      building('way/4', 19.28),
      building('way/5', 19.3)
    ],
    'building-labels.geojson': [address({footprintIndex: 0, 'addr:housenumber': '1'})]
  });
  const gaps = buildingsWithoutNumber(context);
  assert.deepEqual(gaps.map(({key}) => key), ['3', '4']);
  assert.equal(nearestGap(gaps, [19.29, 42.44]).key, '3');
  assert.equal(nearestGap(gaps, [19.29, 42.44], new Set(['3'])).key, '4');
  assert.equal(nearestGap(gaps, [19.29, 42.44], new Set(['3', '4'])), null);
});

test('streets come from the roads, one entry per name, nearest first', () => {
  const roads = [road('Far street', 42.46), road('Near street', 42.4401), road('Near street', 42.45), road('', 42.44)].map(
    feature => ({feature})
  );
  const streets = streetsNear(roads, [19.25, 42.44]);
  assert.deepEqual(streets.map(({name}) => name), ['Near street', 'Far street']);
  assert.ok(streets[0].distanceMetres > 10 && streets[0].distanceMetres < 12);
  assert.deepEqual(matchingStreets(streets, ' FAR').map(({name}) => name), ['Far street']);
});

test('a placed or moved place belongs to the smallest building it is on, or stands on its own', () => {
  const context = contextWith({
    'buildings.geojson': [building('way/1', 19.25), building('way/2', 19.25, {}, 0.0004)]
  });
  assert.equal(buildingAt([19.2502, 42.4402], context).feature.properties.entityId, 'way/2');
  const place = coordinates => ({
    type: 'Feature',
    properties: {name: 'Cafe', standalone: true, buildingEntityId: 'way/9'},
    geometry: {type: 'Point', coordinates}
  });
  const {prepared} = placeBehaviors['places.geojson'];
  const edit = {isNew: true, key: 'local:1'};
  assert.deepEqual(prepared(place([19.2508, 42.4408]), context, edit).properties, {name: 'Cafe', buildingEntityId: 'way/1'});
  assert.deepEqual(prepared(place([19.3, 42.4408]), context, edit).properties, {name: 'Cafe', standalone: true});
  const unmoved = place([19.3, 42.44]);
  const openContext = {...context, session: {workingFeature: () => unmoved}};
  assert.equal(prepared(unmoved, openContext, {isNew: false, key: '0'}), unmoved, 'an unmoved place keeps what it says');
});
