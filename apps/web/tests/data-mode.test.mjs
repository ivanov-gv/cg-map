import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {RELAY_URL, basemapURL, dataEndpoints, resolveDataMode} from '../src/data-mode.js';

test('the host config chooses the data mode and ?api= overrides it', () => {
  assert.equal(resolveDataMode('', {api: 'server'}), 'server');
  assert.equal(resolveDataMode('', {api: 'mock'}), 'mock');
  assert.equal(resolveDataMode('?api=mock', {api: 'server'}), 'mock');
  assert.equal(resolveDataMode('?x=1&api=server', {api: 'mock'}), 'server');
  assert.equal(resolveDataMode('', null), 'mock');
  assert.throws(() => resolveDataMode('?api=live', {api: 'server'}), /Unknown data mode/);
  assert.throws(() => resolveDataMode('', {api: 'live'}), /Invalid config.json/);
  assert.throws(() => resolveDataMode('', {}), /Invalid config.json/);
});

test('server mode uses relative API URLs; mock mode reads the archive and the hosted relay', () => {
  const server = dataEndpoints('server', 'https://maps.example.com/cg-map/');
  assert.deepEqual(server, {layers: 'https://maps.example.com/cg-map/api/v1/layers', vehicles: 'https://maps.example.com/cg-map/api/v1/transport/vehicles'});
  assert.deepEqual(dataEndpoints('mock', 'https://ivanov-gv.github.io/cg-map/'), {layers: null, vehicles: RELAY_URL});
  const archive = 'https://maps.example.com/data/montenegro-0123456789abcdef.pmtiles';
  assert.equal(basemapURL(server, archive, false), server.layers);
  assert.equal(basemapURL(server, archive, true), 'pmtiles://' + archive, 'a verified offline download is used even with the server');
  assert.equal(basemapURL(dataEndpoints('mock', 'https://x/'), archive, false), 'pmtiles://' + archive);
});

test('the static artifact config selects mock data', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('../public/config.json', import.meta.url))), {api: 'mock'});
});
