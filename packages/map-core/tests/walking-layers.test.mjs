import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {mapStyle} from '../src/index.js';

const walkingLayerIds = ['paths', 'footways', 'park-routes', 'cycleways', 'steps'];
const style = mapStyle('pmtiles://archive', 'https://local.test/');
const filters = walkingLayerIds.map(id => ({id, filter: featureFilter(style.layers.find(layer => layer.id === id).filter)}));

function walkingLayersFor(properties) {
  const feature = {type: 2, properties};
  return filters.filter(({filter}) => filter.filter({zoom: 16}, feature)).map(({id}) => id);
}

// Every walking way gets exactly one walking pattern: two would draw dots over steps or over a park route.
test('each walking path class lands in exactly one walking layer', () => {
  const cases = [
    [{kind: 'footway', pathClass: 'main', inGreenArea: true}, 'park-routes'],
    [{kind: 'cycleway', pathClass: 'main', inGreenArea: true}, 'park-routes'],
    [{kind: 'footway', pathClass: 'main'}, 'footways'],
    [{kind: 'path', pathClass: 'main'}, 'footways'],
    [{kind: 'footway'}, 'paths'],
    [{kind: 'path', inGreenArea: true}, 'paths'],
    [{kind: 'track', pathClass: 'trail', inGreenArea: true}, 'paths'],
    [{kind: 'cycleway', pathClass: 'main'}, 'cycleways'],
    [{kind: 'cycleway', pathClass: 'trail'}, 'cycleways'],
    [{kind: 'steps', pathClass: 'trail'}, 'steps'],
    [{kind: 'steps', inGreenArea: true}, 'steps']
  ];
  for (const [properties, expectedLayer] of cases) {
    assert.deepEqual(walkingLayersFor(properties), [expectedLayer], JSON.stringify(properties));
  }
  assert.deepEqual(walkingLayersFor({kind: 'pedestrian', pathClass: 'trail'}), [], 'a pedestrian street stays a street');
});
