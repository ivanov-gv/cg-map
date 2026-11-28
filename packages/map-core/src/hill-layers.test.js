import test from 'node:test';
import assert from 'node:assert/strict';
import {expression} from '@maplibre/maplibre-gl-style-spec';
import {installSummitIcon, summitIconId, summitText} from './hill-layers.js';

// Without the icon MapLibre draws no summit triangle; other missing images belong to their own installers.
test('the summit icon is added once, only when the style asks for it', () => {
  const images = new Map();
  const listeners = new Set();
  const map = {
    on: (_name, listener) => listeners.add(listener),
    off: (_name, listener) => listeners.delete(listener),
    hasImage: id => images.has(id),
    addImage: (id, image, options) => images.set(id, {image, options})
  };
  const stop = installSummitIcon(map);
  const askFor = id => listeners.forEach(listener => listener({id}));
  askFor('some-other-icon');
  assert.equal(images.size, 0);
  askFor(summitIconId);
  askFor(summitIconId);
  const {image, options} = images.get(summitIconId);
  assert.equal(image.data.length, image.width * image.height * 4);
  assert.equal(options.pixelRatio, 2);
  stop();
  assert.equal(listeners.size, 0);
});

function summitLabel(properties) {
  const parsed = expression.createExpression(summitText);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  return parsed.value.evaluate({zoom: 16}, {type: 'Point', properties});
}

// The printed height is rounded from the summit's own stored elevation, with or without a name.
test('a summit with an elevation shows the rounded height', () => {
  assert.equal(summitLabel({name: 'Gorica', ele: 130.04}), 'Gorica · 130 m');
  assert.equal(summitLabel({ele: 129.6}), '130 m');
});

// A terrain-model height is not the summit's own fact, so it leaves no height, separator or unit behind.
test('a summit without an elevation shows no height', () => {
  assert.equal(summitLabel({name: 'Ilijina Glavica', demElevation: 887.36}), 'Ilijina Glavica');
  assert.equal(summitLabel({name: 'Gorica', ele: null}), 'Gorica');
  assert.equal(summitLabel({demElevation: 101.6}), '');
});
