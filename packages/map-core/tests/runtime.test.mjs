import test from 'node:test';
import assert from 'node:assert/strict';
import {createMap, whenMapReady, mapStyle, hitTest, offsetCoordinate, createGeoJSONOverlay} from '../src/index.js';
import {relocateCoreImports} from '../tools/assemble.mjs';

// A small eventful engine keeps lifecycle tests isolated from GPU, network and the DOM.
class TestMap {
  constructor(options) {
    this.options = options;
    this.events = new Map();
    this.sources = new Map();
    this.layers = new Map();
    this.resizeCount = 0;
    this.controls = [];
    this.layout = new Map();
  }
  addControl(control, position) {
    this.controls.push({control, position});
  }
  getContainer() {
    return {clientWidth: 400, clientHeight: 300};
  }
  resize() {
    this.resizeCount++;
  }
  on(name, callback) {
    if (!this.events.has(name)) this.events.set(name, new Set());
    this.events.get(name).add(callback);
  }
  once(name, callback) {
    const wrapper = () => {
      this.off(name, wrapper);
      callback();
    };
    wrapper.original = callback;
    this.on(name, wrapper);
  }
  off(name, callback) {
    for (const registered of this.events.get(name) ?? []) {
      if (registered === callback || registered.original === callback) this.events.get(name).delete(registered);
    }
  }
  emit(name) {
    for (const callback of [...(this.events.get(name) ?? [])]) callback();
  }
  addSource(name, specification) {
    this.sources.set(name, {
      ...specification,
      setData(data) {
        this.data = data;
      }
    });
  }
  getSource(name) {
    return this.sources.get(name);
  }
  removeSource(name) {
    this.sources.delete(name);
  }
  addLayer(layer) {
    this.layers.set(layer.id, layer);
  }
  getLayer(name) {
    return this.layers.get(name);
  }
  removeLayer(name) {
    this.layers.delete(name);
  }
  setLayoutProperty(name, _property, value) {
    this.layout.set(name, value);
  }
  project([longitude, latitude]) {
    return {x: longitude * 10, y: latitude * 10};
  }
  unproject([horizontal, vertical]) {
    return {toArray: () => [horizontal / 10, vertical / 10], distanceTo: () => 100};
  }
  queryRenderedFeatures(bounds, options) {
    this.lastQuery = {bounds, options};
    return [{id: 1}];
  }
}

for (const prefix of ['/', '/cg-map/']) {
  test(`cartography injects local assets at ${prefix}`, () => {
    const baseURL = `https://local.test${prefix}`;
    const style = mapStyle('pmtiles://archive', baseURL);
    assert.equal(style.glyphs, baseURL + 'fonts/{fontstack}/{range}.pbf');
    assert.equal(style.sources['building-addresses'].data, baseURL + 'data/building-labels.geojson');
    assert.equal(style.sources.basemap.url, 'pmtiles://archive');
    assert.ok(style.layers.some(layer => layer.id === 'steps'));
  });
}

test('map lifecycle installs shared controls and tears down observers/listeners', async t => {
  let resizeCallback;
  let didDisconnect = false;
  const scheduledFrames = new Map();
  let nextFrameId = 1;
  const previousGlobals = {
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame
  };
  t.after(() => {
    for (const [name, value] of Object.entries(previousGlobals)) {
      if (value) globalThis[name] = value;
      else delete globalThis[name];
    }
  });
  globalThis.requestAnimationFrame = callback => {
    scheduledFrames.set(nextFrameId, callback);
    return nextFrameId++;
  };
  globalThis.cancelAnimationFrame = frameId => scheduledFrames.delete(frameId);
  globalThis.ResizeObserver = class {
    constructor(callback) {
      resizeCallback = callback;
    }
    observe() {}
    disconnect() {
      didDisconnect = true;
    }
  };
  const engine = {Map: TestMap, NavigationControl: class {}, ScaleControl: class {}};
  const map = createMap({engine, container: 'test', basemapURL: 'archive', assetBaseURL: 'https://local.test/'});
  const ready = whenMapReady(map);
  map.emit('load');
  await ready;
  assert.equal(await whenMapReady(map), map);
  assert.equal(map.controls.length, 2);
  assert.ok(map.getLayer('satellite-preview'));
  resizeCallback();
  resizeCallback();
  assert.equal(map.resizeCount, 0);
  assert.equal(scheduledFrames.size, 1);
  for (const runFrame of scheduledFrames.values()) runFrame();
  assert.equal(map.resizeCount, 1);
  scheduledFrames.clear();
  resizeCallback();
  map.emit('remove');
  assert.equal(scheduledFrames.size, 0);
  await assert.rejects(whenMapReady(map), /has been removed/);
  assert.equal(didDisconnect, true);
  assert.equal(map.events.get('move').size, 0);
  assert.equal(map.events.get('resize').size, 0);
});

test('startup rejects removal and timeout, cleaning listeners', async () => {
  const removed = new TestMap();
  const ready = whenMapReady(removed);
  removed.emit('remove');
  await assert.rejects(ready, /removed before startup/);
  assert.equal(removed.events.get('load').size, 0);
  const stalled = new TestMap();
  await assert.rejects(whenMapReady(stalled, 1), /timed out/);
  assert.equal(stalled.events.get('load').size, 0);
});

test('relative projection and hit tests ignore missing optional layers', () => {
  const map = new TestMap();
  assert.deepEqual(offsetCoordinate(map, [19.25, 42.5], 20, -10), [21.25, 41.5]);
  assert.deepEqual(hitTest(map, {x: 40, y: 50}, ['missing']), []);
  map.addLayer({id: 'present'});
  assert.deepEqual(hitTest(map, {x: 40, y: 50}, ['missing', 'present']), [{id: 1}]);
  assert.deepEqual(map.lastQuery, {
    bounds: [
      [35, 45],
      [45, 55]
    ],
    options: {layers: ['present']}
  });
});

test('overlay selection keeps the geometry of rendered features exposed through a getter', () => {
  class RenderedFeature {
    properties = {name: 'Rendered'};
    get geometry() {
      return {type: 'Point', coordinates: [19, 42]};
    }
  }
  const map = new TestMap();
  createGeoJSONOverlay(map, 'example').setSelection(new RenderedFeature());
  assert.deepEqual(map.getSource('example-selection').data.features, [
    {type: 'Feature', properties: {name: 'Rendered'}, geometry: {type: 'Point', coordinates: [19, 42]}}
  ]);
});

test('overlay selection is independent and teardown removes every owned layer/source', () => {
  const map = new TestMap();
  const feature = {type: 'Feature', properties: {name: 'Original'}, geometry: {type: 'Point', coordinates: [19, 42]}};
  const overlay = createGeoJSONOverlay(map, 'example');
  overlay.setSelection(feature);
  map.getSource('example-selection').data.features[0].properties.name = 'Preview';
  assert.equal(feature.properties.name, 'Original');
  overlay.setVisible(false);
  assert.ok([...map.layout.values()].every(value => value === 'none'));
  overlay.destroy();
  assert.equal(map.layers.size, 0);
  assert.equal(map.sources.size, 0);
});

test('imports of this package are rewritten to the copy inside an artifact, and nothing else is', () => {
  const source = [
    "import {createMap} from '@ivanov-gv/map-core';",
    "import {mapStyle} from '@ivanov-gv/map-core/src/map-style.js';",
    "import {other} from '@ivanov-gv/map-core-extras';",
    "import {local} from './local.js';"
  ].join('\n');
  assert.deepEqual(relocateCoreImports(source).split('\n'), [
    "import {createMap} from './map-core/index.js';",
    "import {mapStyle} from './map-core/map-style.js';",
    "import {other} from '@ivanov-gv/map-core-extras';",
    "import {local} from './local.js';"
  ]);
});
