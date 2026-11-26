import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isPickableEntry} from './roads-host.js';

const layer = {contextFiles: ['slopes.geojson']};
const contextEntry = {filename: 'slopes.geojson', feature: {properties: {kind: 'slope'}}};
const derivedEntry = {filename: 'land.geojson', feature: {properties: {kind: 'country'}}};
const roadEntry = {filename: 'roads.geojson', feature: {properties: {kind: 'residential'}}};

test('a context or derived object is not pickable, while a road is', () => {
  assert.equal(isPickableEntry(contextEntry, layer), false);
  assert.equal(isPickableEntry(derivedEntry, layer), false);
  assert.equal(isPickableEntry(roadEntry, layer), true);
});

// app.js used to keep a second rule here, so no component test could see it drift away from the shared one. Evaluate
// that one binding with the real rule to keep the host delegating.
test('app.js binds isPickable to the shared rule', async () => {
  const source = await readFile(new URL('../../app.js', import.meta.url), 'utf8');
  const binding = source.split('\n').find(line => line.startsWith('const isPickable ='));
  assert.ok(binding, 'app.js should bind isPickable once');
  const isPickable = vm.runInNewContext(`${binding}; isPickable`, {activeLayer: layer, isPickableEntry});
  assert.equal(isPickable(contextEntry), false);
  assert.equal(isPickable(derivedEntry), false);
  assert.equal(isPickable(roadEntry), true);
});
