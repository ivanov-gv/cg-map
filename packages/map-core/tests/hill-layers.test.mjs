import test from 'node:test';
import assert from 'node:assert/strict';
import {expression} from '@maplibre/maplibre-gl-style-spec';
import {installSummitIcon, summitIconId, summitText} from '../src/hill-layers.js';

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

// OSM height wins over the terrain model's, both round to whole metres, and an unnamed summit shows its height only.
test('summit labels read "Name · height m" from the best height available', () => {
  const parsed = expression.createExpression(summitText);
  assert.equal(parsed.result, 'success', JSON.stringify(parsed.value));
  const label = properties => parsed.value.evaluate({zoom: 16}, {type: 'Point', properties});
  assert.equal(label({name: 'Gorica', ele: 130, demElevation: 131.04}), 'Gorica · 130 m');
  assert.equal(label({name: 'Ilijina Glavica', demElevation: 887.36}), 'Ilijina Glavica · 887 m');
  assert.equal(label({demElevation: 101.6}), '102 m');
});
