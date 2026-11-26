import test from 'node:test';
import assert from 'node:assert/strict';
import {featureForEntry, junctionEntry} from './layer-junctions.js';

test('a junction opens its derived feature and a road opens the feature the session now holds', () => {
  const junction = junctionEntry([19.26, 42.44]);
  const original = {properties: {name: 'Main street'}};
  const working = {properties: {name: 'Renamed street'}};
  const session = {
    workingFeature(filename, key) {
      assert.equal(filename, 'roads.geojson');
      assert.equal(key, 'way/30');
      return working;
    }
  };
  assert.equal(featureForEntry(junction, session), junction.feature);
  assert.equal(featureForEntry({filename: 'roads.geojson', key: 'way/30', feature: original}, session), working);
});
