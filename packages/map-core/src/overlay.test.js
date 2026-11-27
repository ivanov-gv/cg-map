import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeoJSONOverlay} from './index.js';

// Only source, layer and paint state matter here; GPU and event behaviour belongs to the map lifecycle tests.
class OverlayMap {
  constructor() {
    this.sources = new Map();
    this.layers = new Map();
    this.layout = new Map();
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
  setPaintProperty(name, property, value) {
    this.layers.get(name).paint[property] = value;
  }
}

test('overlay selection keeps the geometry of rendered features exposed through a getter', () => {
  class RenderedFeature {
    properties = {name: 'Rendered'};
    get geometry() {
      return {type: 'Point', coordinates: [19, 42]};
    }
  }
  const map = new OverlayMap();
  createGeoJSONOverlay(map, 'example').setSelection(new RenderedFeature());
  assert.deepEqual(map.getSource('example-selection').data.features, [
    {type: 'Feature', properties: {name: 'Rendered'}, geometry: {type: 'Point', coordinates: [19, 42]}}
  ]);
});

test('overlay selection is independent and teardown removes every owned layer/source', () => {
  const map = new OverlayMap();
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

// The selection is always Highlighted; the overlay switches between Default and Editable without new layers.
test('overlay states paint the selection red and an editable overlay as a thin green outline', () => {
  const map = new OverlayMap();
  const overlay = createGeoJSONOverlay(map, 'example');
  assert.equal(map.getLayer('example-selection-line').paint['line-color'], '#c8372d');
  assert.equal(map.getLayer('example-selection-fill').paint['fill-opacity'], 0.15);
  overlay.setState('editable');
  assert.equal(map.getLayer('example-line').paint['line-color'], '#2e8b57');
  assert.equal(map.getLayer('example-line').paint['line-width'], 1.5);
  assert.equal(map.getLayer('example-fill').paint['fill-opacity'], 0);
  overlay.setState('default');
  assert.equal(map.getLayer('example-fill').paint['fill-opacity'], 0.22);
  assert.ok(map.getLayer('example-line').paint['line-width'] <= map.getLayer('example-selection-line').paint['line-width']);
  assert.throws(() => overlay.setState('highlighted'), /Unknown overlay state/);
});
