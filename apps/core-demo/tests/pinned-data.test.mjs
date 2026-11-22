import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pinnedDataRoot, readPinnedSource} from './pinned-data.mjs';

test('concept-app tests read sources from the pinned package', () => {
  assert.match(pinnedDataRoot, /node_modules\/@ivanov-gv\/map-data$/);
  const appPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = JSON.parse(fs.readFileSync(path.join(pinnedDataRoot, 'package.json'), 'utf8'));
  const pin = appPackage.devDependencies['@ivanov-gv/map-data'];
  assert.match(pin, /^\d+\.\d+\.\d+$/);
  assert.equal(pin, installed.version);
  const places = JSON.parse(readPinnedSource('places.geojson'));
  assert.ok(places.features.length > 0);
});
