import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pinnedContractsRoot} from './pinned-contracts.mjs';
import {bundleFilesByVersion} from '../src/source-data/source-bundle.js';
import {availableLayers, entriesForLayer} from '../src/layers/shared/editor-layers.js';
import {behaviorOf, drawChoicesOf} from '../src/layers/shared/layer-behaviors.js';
import {isFormField} from '../src/inspector/property-form.js';
import {routeBehaviors} from '../src/layers/routes/layer-routes.js';
import {rulesForBundleVersion} from '../src/layers/shared/layer-rules.js';
import {surfacePreviewFeatures} from '../src/map-tools/basemap-layers.js';
import {
  linkedSelection,
  municipalityCompanions,
  movedStoredValue,
  frameTopologyProblem,
  shadeProblem,
  shadeSeed,
  storedPositionFeatures,
  surfaceEditProblem,
  surfaceKindProblem,
  surfaceResultProblemForEdits
} from '../src/layers/shared/surface-edits.js';
import {
  registerVersion5Behaviors,
  version5StoredPositions,
  version5SurfaceBehaviorsByLayer
} from '../src/layers/shared/version5-behaviors.js';

registerVersion5Behaviors();

const surfaceFile = 'surface.geojson';
const ring = (west, south, east, north) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south]
];
const square = ring(19, 42, 19.001, 42.001);
const feature = (properties, geometry) => ({type: 'Feature', properties, geometry});
const entry = (key, properties, geometry) => ({filename: surfaceFile, key, feature: feature(properties, geometry)});
const area = entry('0', {kind: 'park', entityId: 'way/50'}, {type: 'Polygon', coordinates: [square]});
const contextOf = (...entries) => ({entriesOf: () => entries});
const resultOf = (after, entries, key, baseEntries = entries) =>
  surfaceResultProblemForEdits(
    {baseEntries: () => baseEntries},
    contextOf(...entries),
    [{filename: surfaceFile, key, after}]
  );
const rounded = value =>
  Array.isArray(value[0]) ? value.map(point => point.map(coordinate => Number(coordinate.toFixed(10)))) : value;

function editOf(current, entries = [current], {unapplied = false, typedFeature = null} = {}) {
  const properties = [];
  const problems = [];
  let replaced = null;
  let started = null;
  return {
    key: current.key,
    context: {...contextOf(...entries), startNew: specification => (started = specification)},
    typedFeature: () => typedFeature?.() ?? current.feature,
    setProperties: values => properties.push(values),
    showProblem: message => problems.push(message),
    replaceWith: (edits, message) => {
      replaced = {edits, message};
    },
    hasUnappliedEdit: () => unapplied,
    isOpen: () => true,
    properties,
    problems,
    get replaced() {
      return replaced;
    },
    get started() {
      return started;
    }
  };
}

// A little DOM is enough to prove that the river control writes a normal form field; the browser suite covers the form.
function withDocument(run) {
  const previousDocument = globalThis.document;
  const previousEvent = globalThis.Event;
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.listeners = new Map();
      this.className = '';
      this.value = '';
      this.attributes = {};
    }
    append(...children) {
      this.children.push(...children);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    dispatchEvent(event) {
      this.listeners.get(event.type)?.(event);
      return true;
    }
    showModal() {
      this.isOpen = true;
    }
    close() {
      this.isOpen = false;
      this.dispatchEvent({type: 'close'});
    }
    remove() {
      this.removed = true;
    }
    focus() {
      this.hasFocus = true;
    }
    set textContent(value) {
      this.text = value;
    }
    get textContent() {
      return this.text ?? '';
    }
  }
  const body = new Element('body');
  globalThis.document = {body, createElement: tagName => new Element(tagName)};
  globalThis.Event = class {
    constructor(type) {
      this.type = type;
    }
  };
  try {
    return run(body);
  } finally {
    globalThis.document = previousDocument;
    globalThis.Event = previousEvent;
  }
}

test('the owner draws a shade; seeding it records only the link', () => {
  const seed = shadeSeed(area);
  assert.deepEqual(seed, {kind: 'shade', greenAreaEntityId: 'way/50'});
  assert.equal(shadeSeed(entry('1', {kind: 'sea'}, area.feature.geometry)), null);

  const edit = editOf(area);
  const behavior = version5SurfaceBehaviorsByLayer.green[surfaceFile];
  const draw = behavior.tools(area.feature, edit).find(({label}) => label === 'Draw shade');
  assert.ok(draw, 'the green layer offers a shade to draw');
  draw.run();
  assert.deepEqual(edit.started, {
    label: 'Draw shade',
    filename: surfaceFile,
    shape: 'Polygon',
    properties: seed
  });
  assert.equal(edit.replaced, null, 'drawing a shade does not record a derived copy');

  const dirtyEdit = editOf(area, [area], {unapplied: true});
  behavior.tools(area.feature, dirtyEdit).find(({label}) => label === 'Draw shade').run();
  assert.equal(dirtyEdit.started, null, 'an unapplied parent edit is not discarded');
  assert.deepEqual(dirtyEdit.problems, ['Apply or Cancel the parent area before drawing its shade.']);

  const ringCoordinates = ring(19.0002, 42.0002, 19.0004, 42.0004);
  const drawn = feature(seed, {type: 'MultiPolygon', coordinates: [[ringCoordinates]]});
  assert.equal(shadeProblem({key: 'local:shade', feature: drawn}, contextOf(area)), null);
  assert.deepEqual(
    behavior.prepared(feature(seed, {type: 'Polygon', coordinates: [ringCoordinates]})),
    drawn,
    'the drawn ring is stored as the MultiPolygon the contract requires'
  );
});

test('a shade must stay inside the whole area, including around holes', () => {
  const withHole = entry('0', {kind: 'park', entityId: 'way/50'}, {
    type: 'Polygon',
    coordinates: [ring(0, 0, 1, 1), ring(0.3, 0.3, 0.7, 0.7)]
  });
  const link = {kind: 'shade', greenAreaEntityId: 'way/50'};
  const inside = feature(link, {type: 'MultiPolygon', coordinates: [[ring(0.05, 0.05, 0.2, 0.2)]]});
  assert.equal(shadeProblem({key: '1', feature: inside}, contextOf(withHole, entry('1', link, inside.geometry))), null);

  const multi = feature(link, {
    type: 'MultiPolygon',
    coordinates: [[ring(0.05, 0.05, 0.2, 0.2)], [ring(0.8, 0.8, 0.9, 0.9)]]
  });
  assert.equal(shadeProblem({key: '1', feature: multi}, contextOf(withHole, entry('1', link, multi.geometry))), null);

  // Every corner and edge is outside the hole, but the shade covers the courtyard the hole cuts out.
  const aroundHole = feature(link, {type: 'MultiPolygon', coordinates: [[ring(0.2, 0.2, 0.8, 0.8)]]});
  assert.match(
    shadeProblem({key: '1', feature: aroundHole}, contextOf(withHole, entry('1', link, aroundHole.geometry))),
    /inside its green area/
  );

  // Every vertex is outside the hole, but the band runs straight across it.
  const acrossHole = feature(link, {type: 'MultiPolygon', coordinates: [[ring(0.2, 0.45, 0.8, 0.55)]]});
  assert.match(
    shadeProblem({key: '1', feature: acrossHole}, contextOf(withHole, entry('1', link, acrossHole.geometry))),
    /inside its green area/
  );

  const dangling = feature({...link, greenAreaEntityId: 'way/99'}, inside.geometry);
  assert.match(
    shadeProblem({key: '1', feature: dangling}, contextOf(withHole, entry('1', dangling.properties, dangling.geometry))),
    /name a green area/
  );
  const second = entry('2', link, inside.geometry);
  assert.match(
    shadeProblem({key: '1', feature: inside}, contextOf(withHole, entry('1', link, inside.geometry), second)),
    /already has a shade/
  );
});

test('Apply, delete and import judge the resulting file, not just the open edit', () => {
  const shade = entry('1', {kind: 'shade', greenAreaEntityId: 'way/50'}, {
    type: 'MultiPolygon',
    coordinates: [[ring(19.0002, 42.0002, 19.0004, 42.0004)]]
  });
  const entries = [area, shade];
  assert.equal(resultOf(area.feature, entries, '0'), null);

  const shrunk = feature(area.feature.properties, {
    type: 'Polygon',
    coordinates: [ring(19, 42, 19.0001, 42.0001)]
  });
  assert.match(resultOf(shrunk, entries, '0'), /stay inside its green area/);
  assert.match(resultOf(null, entries, '0'), /name a green area/);
  const retyped = feature({...area.feature.properties, kind: 'lake'}, area.feature.geometry);
  assert.match(resultOf(retyped, entries, '0'), /name a green area/);

  const polygonShade = feature(shade.feature.properties, {
    type: 'Polygon',
    coordinates: [shade.feature.geometry.coordinates[0][0]]
  });
  const withPolygonShade = [area, entry('1', shade.feature.properties, polygonShade.geometry)];
  assert.match(resultOf(polygonShade, withPolygonShade, '1'), /MultiPolygon area/);

  const second = feature(shade.feature.properties, shade.feature.geometry);
  assert.match(resultOf(second, entries, 'local:shade'), /already has a shade/);
});

test('kind and geometry are one decision, and a river link names a waterway in the same file', () => {
  const river = entry('1', {kind: 'river', entityId: 'way/61'}, {
    type: 'LineString',
    coordinates: [[19, 42], [19.1, 42.1]]
  });
  const riverPolygon = entry('2', {kind: 'river', entityId: 'way/62'}, {
    type: 'Polygon',
    coordinates: [square]
  });
  const lake = entry('0', {kind: 'lake'}, {type: 'Polygon', coordinates: [square]});
  const context = contextOf(area, lake, river, riverPolygon);

  assert.match(surfaceKindProblem({feature: {...area.feature, properties: {...area.feature.properties, kind: 'municipality'}}, before: area.feature}, context), /cannot be changed/);
  assert.match(surfaceKindProblem({feature: {...area.feature, geometry: river.feature.geometry}, before: area.feature}, context), /park needs an area/);
  assert.match(surfaceKindProblem({feature: {...lake.feature, properties: {...lake.feature.properties, riverEntityId: 'way/99'}}}, context), /name a waterway/);
  assert.match(surfaceKindProblem({feature: {...lake.feature, properties: {...lake.feature.properties, riverEntityId: 'way/62'}}}, context), /name a waterway/);
  assert.equal(
    surfaceKindProblem({feature: {...lake.feature, properties: {...lake.feature.properties, riverEntityId: 'way/61'}}}, context),
    null
  );

  const linked = {...lake, feature: {...lake.feature, properties: {...lake.feature.properties, riverEntityId: 'way/61'}}};
  assert.equal(linkedSelection(linked, context), river);
  assert.equal(linkedSelection(lake, context), lake);
});

test('the water form picks a waterway and the reference field has a control', () => {
  const river = entry('1', {kind: 'river', entityId: 'way/61', name: 'Creek'}, {
    type: 'LineString',
    coordinates: [[19, 42], [19.1, 42.1]]
  });
  const riverArea = entry('2', {kind: 'river', entityId: 'way/62', name: 'Broad floodway'}, {
    type: 'Polygon',
    coordinates: [square]
  });
  const lake = entry('0', {kind: 'lake'}, {type: 'Polygon', coordinates: [square]});
  const rule = {reference: surfaceFile};
  assert.equal(isFormField(rule, 'riverEntityId', {}), false);
  assert.equal(isFormField(rule, 'riverEntityId', {riverEntityId: () => null}), true);

  withDocument(body => {
    const behavior = version5SurfaceBehaviorsByLayer.water[surfaceFile];
    const edit = editOf(lake, [lake, river, riverArea]);
    const control = behavior.controls(edit).riverEntityId('');
    const input = control.children.find(({tagName}) => tagName === 'INPUT');
    const buttons = control.children.filter(({tagName}) => tagName === 'BUTTON');
    const choose = buttons.find(({textContent}) => textContent === 'Choose');
    const clear = buttons.find(({textContent}) => textContent === 'Clear');
    assert.equal(input.name, 'riverEntityId');
    assert.equal(input.readOnly, true);
    assert.ok(clear, 'an optional link can be cleared');
    choose.onclick();
    const dialog = body.children.at(-1);
    assert.equal(dialog.className, 'river-dialog');
    assert.deepEqual(
      dialog.children.filter(({tagName}) => tagName === 'BUTTON').map(({textContent}) => textContent),
      ['Creek', 'Cancel'],
      'a river polygon is not offered as a waterway'
    );
    const riverButton = dialog.children.find(({tagName, textContent}) => tagName === 'BUTTON' && textContent === 'Creek');
    riverButton.onclick();
    assert.equal(input.value, 'way/61');
    assert.equal(dialog.isOpen, false);
    clear.onclick();
    assert.equal(input.value, '', 'Clear empties the normal form field');
  });
});

test('stored positions are checked as WGS84, kept inside lakes and offered when still unset', () => {
  const lake = entry('0', {kind: 'lake'}, {type: 'Polygon', coordinates: [square]});
  const outside = {...lake, feature: feature({...lake.feature.properties, iconPoint: [20, 43]}, lake.feature.geometry)};
  assert.match(surfaceEditProblem({key: outside.key, feature: outside.feature}, contextOf(outside)), /icon must stay inside/);
  const invalid = {...lake, feature: feature({...lake.feature.properties, iconPoint: [200, 43]}, lake.feature.geometry)};
  assert.match(surfaceEditProblem({key: invalid.key, feature: invalid.feature}, contextOf(invalid)), /WGS84 longitude/);
  const badLine = {...lake, feature: feature({...lake.feature.properties, labelLine: [[19, 42]]}, lake.feature.geometry)};
  assert.match(surfaceEditProblem({key: badLine.key, feature: badLine.feature}, contextOf(badLine)), /at least two distinct WGS84/);

  const typed = feature({...lake.feature.properties, poiKind: 'cafe'}, lake.feature.geometry);
  const currentForm = editOf(lake, [lake], {typedFeature: () => typed});
  assert.ok(
    version5SurfaceBehaviorsByLayer.green[surfaceFile]
      .tools(lake.feature, currentForm)
      .some(({label}) => label === 'Move icon point'),
    'the toolbar sees a POI kind chosen in the current form'
  );

  const multiLake = entry('0', {kind: 'lake', iconPoint: [19.5, 42.5]}, {
    type: 'MultiPolygon',
    coordinates: [[square], [ring(19.4, 42.4, 19.6, 42.6)]]
  });
  assert.equal(surfaceEditProblem({key: multiLake.key, feature: multiLake.feature}, contextOf(multiLake)), null);

  const newPoi = entry('0', {kind: 'lake', poiKind: 'cafe'}, lake.feature.geometry);
  const edit = editOf(newPoi);
  edit.context.pickPoint = async () => [19.0005, 42.0005];
  const placeIcon = version5SurfaceBehaviorsByLayer.green[surfaceFile]
    .tools(newPoi.feature, edit)
    .find(({label}) => label === 'Move icon point');
  assert.ok(placeIcon, 'an unset icon can be placed once the lake has a POI kind');
  return placeIcon.run().then(() => {
    assert.deepEqual(edit.properties, [{iconPoint: [19.0005, 42.0005]}]);
    const labelled = entry('2', {
      labelPoint: [19.2, 42.4],
      labelLine: [[19.2, 42.4], [19.3, 42.4]],
      iconPoint: [19.4, 42.4]
    }, lake.feature.geometry);
    assert.deepEqual(version5StoredPositions([labelled]).map(({properties}) => properties.field), [
      'labelPoint', 'labelLine', 'iconPoint'
    ]);
    assert.deepEqual(storedPositionFeatures([labelled]), version5StoredPositions([labelled]));
    assert.deepEqual(rounded(movedStoredValue('labelLine', labelled.feature.properties.labelLine, [19.5, 42.5])), [
      [19.45, 42.5],
      [19.55, 42.5]
    ]);
  });
});

test('every frame outline follows a shared edge, and a one-sided move is refused', () => {
  const closed = points => [...points, points[0]];
  const movedPoint = (points, at, to) => points.map(point => (JSON.stringify(point) === JSON.stringify(at) ? to : point));
  const westRing = closed([[0, -6], [0, 0], [0, 6], [-6, 6], [-6, 0], [-6, -6]]);
  const holeRing = closed([[-5, 2], [-4.5, 2], [-4, 2], [-4, 3], [-5, 3]]);
  const eastRing = closed([[0, -6], [6, -6], [6, 6], [0, 6], [0, 0]]);
  const seaRing = closed([[-9, -9], [-6, -9], [-6, -6], [-6, 0], [-6, 6], [-9, 6]]);
  const west = entry('0', {kind: 'municipality', entityId: 'relation/90'}, {
    type: 'Polygon',
    coordinates: [westRing, holeRing]
  });
  const east = entry('1', {kind: 'municipality', entityId: 'relation/91'}, {type: 'Polygon', coordinates: [eastRing]});
  const sea = entry('2', {kind: 'sea', entityId: 'derived:sea'}, {type: 'Polygon', coordinates: [seaRing]});
  const holeOwner = entry('3', {kind: 'context', entityId: 'relation/92'}, {type: 'Polygon', coordinates: [holeRing]});
  const base = [west, east, sea, holeOwner];
  const moved = feature(west.feature.properties, {
    type: 'Polygon',
    coordinates: [
      movedPoint(movedPoint(westRing, [0, 0], [0.5, 0]), [-6, 0], [-8, 0]),
      movedPoint(holeRing, [-4.5, 2], [-4.5, 1.5])
    ]
  });
  const edits = municipalityCompanions({key: west.key, before: west.feature, feature: moved}, contextOf(...base));
  assert.deepEqual(edits.map(({key}) => key).sort(), ['1', '2', '3'], 'the neighbour, the sea and the hole all follow');
  const coordinates = edits.map(({after}) => JSON.stringify(after.geometry.coordinates));
  assert.ok(coordinates.some(text => text.includes('0.5,0')), 'the neighbour follows the moved corner');
  assert.ok(coordinates.some(text => text.includes('-8,0')), 'the sea follows the moved coast');
  assert.ok(coordinates.some(text => text.includes('-4.5,1.5')), 'the hole boundary follows');

  const result = [moved, ...edits.map(({after}) => after)].map((current, index) => ({
    filename: surfaceFile,
    key: String(index),
    feature: current
  }));
  assert.equal(resultOf(moved, result, '0', base), null, 'the whole frame still fits together');

  const oneSided = base.map((current, index) => (index === 0 ? {...current, feature: moved} : current));
  assert.match(resultOf(moved, oneSided, '0', base), /shared frame edge/);
});

test('a corner with one shared frame edge still takes its neighbour with it', () => {
  const westRing = [[0, 0], [0, 1], [-1, 1], [-1, 0], [0, 0]];
  const eastRing = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const west = entry('0', {kind: 'municipality', entityId: 'relation/90'}, {type: 'Polygon', coordinates: [westRing]});
  const east = entry('1', {kind: 'municipality', entityId: 'relation/91'}, {type: 'Polygon', coordinates: [eastRing]});
  const movedRing = westRing.map(point => (point[0] === 0 && point[1] === 1 ? [0.3, 1] : point));
  const moved = feature(west.feature.properties, {type: 'Polygon', coordinates: [movedRing]});
  const edits = municipalityCompanions({key: west.key, before: west.feature, feature: moved}, contextOf(west, east));

  assert.deepEqual(edits.map(({key}) => key), ['1'], 'the owner of the one shared edge follows');
  assert.ok(
    edits[0].after.geometry.coordinates[0].some(([east, north]) => east === 0.3 && north === 1),
    'the shared corner moves on the neighbour too'
  );
  const fitted = [moved, edits[0].after].map((current, index) =>
    entry(String(index), current.properties, current.geometry)
  );
  assert.equal(resultOf(moved, fitted, '0', [west, east]), null);
  assert.match(resultOf(moved, [moved, east], '0', [west, east]), /shared frame edge/);
});

test('one frame polygon inside another is refused even without touching edges', () => {
  const outer = entry('0', {kind: 'context', entityId: 'relation/1'}, {
    type: 'Polygon',
    coordinates: [ring(0, 0, 1, 1)]
  });
  const inner = entry('1', {kind: 'municipality', entityId: 'relation/2'}, {
    type: 'Polygon',
    coordinates: [ring(0.2, 0.2, 0.8, 0.8)]
  });
  assert.match(frameTopologyProblem([outer, inner]), /Frame polygons overlap/);
  assert.equal(frameTopologyProblem([outer]), null);
});

test('a version 5 surface preview is owned by its behavior and hands the whole file to map-core', () => {
  const behavior = behaviorOf(surfaceFile, 'green', 5);
  const sessions = {workingEntries: () => [area]};
  const sources = new Map([[surfaceFile, {}]]);
  assert.deepEqual(behavior.previewEntries(surfaceFile, {session: sessions, sources}), [area]);
  assert.equal(behavior.previewEntries(surfaceFile, {session: sessions, sources: new Map()}), null);
  assert.equal(behavior.previewFeatures, surfacePreviewFeatures);
  assert.deepEqual(behavior.storedPositions([area]), []);

  const municipality = entry('1', {kind: 'municipality', name: 'West', labelPoint: [19, 42]}, {
    type: 'Polygon',
    coordinates: [ring(18, 41, 18.01, 41.01)]
  });
  const lake = entry('2', {kind: 'lake', iconPoint: [19.0005, 42.0005]}, {type: 'Polygon', coordinates: [square]});
  const labelled = entry('3', {kind: 'park', labelLine: [[19.0002, 42.0002], [19.0008, 42.0002]]}, {
    type: 'Polygon',
    coordinates: [square]
  });
  const river = entry('4', {kind: 'river'}, {type: 'LineString', coordinates: [[19, 42], [19.1, 42.1]]});
  const features = [area, municipality, lake, labelled, river].map(({feature}) => feature);
  const land = surfacePreviewFeatures({id: 'land', 'source-layer': 'land'}, features);
  assert.deepEqual(land.map(({properties}) => properties.kind), ['park', 'park'], 'land takes green cover only');
  const water = surfacePreviewFeatures({id: 'water', 'source-layer': 'water'}, features);
  assert.deepEqual(water.map(({properties}) => properties.kind), ['municipality', 'lake']);
  const rivers = surfacePreviewFeatures({id: 'rivers', 'source-layer': 'water'}, features);
  assert.deepEqual(rivers, [river.feature], 'the published river layer takes waterway lines, not water areas');
  const labels = surfacePreviewFeatures({id: 'surface_labels', 'source-layer': 'surface_labels'}, features);
  assert.deepEqual(labels.map(({geometry}) => geometry.coordinates), [municipality.feature.properties.labelPoint]);
  const icons = surfacePreviewFeatures({'source-layer': 'poi_labels'}, features);
  assert.deepEqual(icons.map(({geometry}) => geometry.coordinates), [lake.feature.properties.iconPoint]);
  const parkNames = surfacePreviewFeatures({'source-layer': 'green_area_labels'}, features);
  assert.deepEqual(parkNames.map(({geometry}) => geometry.coordinates), [labelled.feature.properties.labelLine]);
});

test('version 5 uses its own layer kinds, draw choices and behavior', () => {
  const contracts = JSON.parse(readFileSync(path.join(pinnedContractsRoot, 'editor-layers.json'), 'utf8'));
  const version5 = rulesForBundleVersion(contracts, 5);
  const released = rulesForBundleVersion(contracts, 3);
  const layers5 = availableLayers(bundleFilesByVersion[5], 5);
  assert.equal(layers5.find(({id}) => id === 'addresses'), undefined);
  assert.deepEqual(layers5.find(({id}) => id === 'green').files, [surfaceFile]);
  assert.deepEqual(layers5.find(({id}) => id === 'relief').files, ['relief.geojson', 'canyon-rims.geojson']);
  const layers3 = availableLayers(bundleFilesByVersion[3], 3);
  assert.deepEqual(layers3.find(({id}) => id === 'green').files, ['land.geojson', 'protected-areas.geojson']);

  const municipality = entry('1', {kind: 'municipality'}, {type: 'Polygon', coordinates: [square]});
  const lake = entry('2', {kind: 'lake'}, {type: 'Polygon', coordinates: [square]});
  const entries = [area, municipality, lake];
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'green'), entries), [area]);
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'settlements'), entries), [municipality]);
  assert.deepEqual(entriesForLayer(layers5.find(({id}) => id === 'water'), entries), [lake]);
  assert.deepEqual(entriesForLayer(layers3.find(({id}) => id === 'green'), entries), entries);

  assert.equal(drawChoicesOf(layers5.find(({id}) => id === 'green'), version5)[0].filename, surfaceFile);
  assert.equal(drawChoicesOf(layers3.find(({id}) => id === 'green'), released)[0].filename, 'land.geojson');
  assert.equal(behaviorOf(surfaceFile, 'green', 5).kind({properties: {kind: 'protected-area'}}), 'protected area');
  assert.equal(behaviorOf('water.geojson', 'water', 5).tools(area.feature, editOf(area)).length, 0);
  assert.equal(behaviorOf(surfaceFile, null, 3).tools(area.feature, editOf(area)).length, 0);
});

test('version 5 routes keep the released display but derive neither headsign nor stop lines', () => {
  const route = routeBehaviors['transit-routes.json'];
  const version5Route = behaviorOf('transit-routes.json', 'routes', 5);
  assert.equal(version5Route.isViewOnly({isPhone: () => true}), true);
  assert.equal(version5Route.isViewOnly({isPhone: () => false}), false);
  assert.equal(version5Route.problem, route.problem);
  assert.equal(version5Route.renderExtras, route.renderExtras);

  const featureWithStops = feature({number: '6', network: 'bus', directions: [{headsign: '', stops: ['1', '2']}]}, null);
  const stopContext = {entriesOf: () => [{feature: {properties: {stopId: '2', name: 'Middle'}}}]};
  assert.equal(route.directionLabel(featureWithStops.properties.directions[0], 0, stopContext), 'To Middle');
  assert.equal(version5Route.directionLabel(featureWithStops.properties.directions[0], 0, stopContext), 'Direction 1');
  assert.deepEqual(version5Route.prepared(featureWithStops, stopContext), featureWithStops);

  const intercity = feature({number: '6', network: 'intercity', directions: [{headsign: '', stops: ['1', '2']}]}, null);
  const prepared = version5Route.prepared(intercity);
  assert.equal(prepared.properties.directions[0].headsign, '', 'a source headsign is not derived from a stop name');
  assert.match(prepared.properties.directions[0].entityId, /^local:/, 'a new direction still gets producer identity');
  assert.deepEqual(version5Route.companionEdits({key: '0', feature: featureWithStops}, stopContext), []);
});
