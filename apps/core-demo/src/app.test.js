import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {pinnedContractsRoot} from '../tests/pinned-contracts.mjs';
import {readPinnedSource} from '../tests/pinned-data.mjs';
import {demoVisibilitySamples, resolveDemoVisibility} from './app.js';

const rawVisibilityConfig = JSON.parse(
  readFileSync(path.join(pinnedContractsRoot, 'place-visibility.json'), 'utf8')
);
const visibilityPolicy = JSON.parse(readPinnedSource('place-visibility-policy.json'));
const thresholdFor = level => rawVisibilityConfig.levels.find(entry => entry.level === level).minZoom;

test('concept artifact imports only the public core surface and has no product dependencies', () => {
  const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(imports, ['@ivanov-gv/map-core']);
  assert.doesNotMatch(source, /serviceWorker|localStorage|apps\/web|apps\/editor/);
});

test('the demo resolves version-5 samples from the data policy and an override', () => {
  for (const {feature} of demoVisibilitySamples) {
    assert.ok(feature.properties.entityId, 'a version-5 sample has a stable identity');
    assert.equal(Object.hasOwn(feature.properties, 'visibilityLevel'), false);
  }
  const {samples} = resolveDemoVisibility(rawVisibilityConfig, visibilityPolicy);
  const samplesById = new Map(samples.map(sample => [sample.id, sample]));
  const kindSample = samplesById.get('kind-band');
  const overrideSample = samplesById.get('override-band');
  assert.equal(kindSample.level, visibilityPolicy.kinds.museum);
  assert.equal(kindSample.zoom, thresholdFor(visibilityPolicy.kinds.museum));
  assert.equal(overrideSample.level, 4);
  assert.equal(overrideSample.zoom, thresholdFor(4));
});
