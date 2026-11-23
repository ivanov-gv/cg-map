import test from 'node:test';
import assert from 'node:assert/strict';
import {installSummitIcon, summitIconId} from '../src/hill-layers.js';

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
