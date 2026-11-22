import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {pinnedDataRoot, readPinnedSource, readPinnedFixture} from './pinned-data.mjs';

test('web tests read sources and fixtures from the pinned package', () => {
  assert.match(pinnedDataRoot, /node_modules\/@ivanov-gv\/map-data$/);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fileSystem.readFileSync(path.join(pinnedDataRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-data'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
  const labels = JSON.parse(readPinnedSource('building-labels.geojson'));
  assert.ok(labels.features.length > 0);
  const fixture = JSON.parse(readPinnedFixture('podgorica-places.geojson'));
  assert.ok(fixture.features.length > 0);
});
