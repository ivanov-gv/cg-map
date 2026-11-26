import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {assertShellIncludesModules, discoverShellAssets} from '../tools/offline-shell.mjs';
import {findRuntimeModules} from '../tools/runtime-modules.mjs';
import {buildFixture, createFixtureProject, finalizeFixture, readFixtureManifest} from './fixture-project.mjs';

test('offline shell includes every built runtime module and excludes the worker', testContext => {
  const fixture = createFixtureProject(testContext);
  buildFixture(fixture);
  const manifest = readFixtureManifest(fixture);
  assertShellIncludesModules(findRuntimeModules(fixture.source), manifest.shell);
  assert.ok(manifest.shell.includes('feature/nested.js'));
  assert.ok(!manifest.shell.includes('sw.js'));
});

test('shell discovery excludes host config, generated output, downloads, and test support', testContext => {
  const fixture = createFixtureProject(testContext);
  buildFixture(fixture);
  fs.writeFileSync(path.join(fixture.output, 'data/stale.pmtiles.partial'), 'incomplete download');
  fs.writeFileSync(path.join(fixture.output, 'data/range-payload.bin'), 'range response');
  finalizeFixture(fixture);

  const discovered = discoverShellAssets(fixture.output);
  for (const excluded of [
    '.nojekyll',
    'config.json',
    'sw.js',
    'offline-manifest.js',
    'data/manifest.json',
    'data/stale.pmtiles.partial',
    'data/range-payload.bin',
    'feature/nested.test.js',
    'test-support/helper.js'
  ])
    assert.ok(!discovered.includes(excluded), `${excluded} must stay outside the shell`);
  assert.ok(!discovered.some(asset => asset.endsWith('.pmtiles')));
  assert.ok(!discovered.some(asset => !asset.startsWith('data/satellite/') && asset.endsWith('.bin')));

  for (const included of [
    'index.html',
    'app.js',
    'feature/nested.js',
    'style.css',
    'vendor/maplibre-gl.js',
    'map-core/index.js',
    'fonts/Open Sans Semibold/0-255.pbf',
    'data/places.geojson',
    'data/satellite/manifest.json'
  ])
    assert.ok(discovered.includes(included), `${included} must stay in the shell`);
});

test('shell discovery excludes archive and partial files even when the data allow rule matches them', testContext => {
  const fixture = createFixtureProject(testContext);
  buildFixture(fixture);
  fs.writeFileSync(path.join(fixture.output, 'data/archive.pmtiles'), 'full archive bytes');
  fs.writeFileSync(path.join(fixture.output, 'data/archive.pmtiles.partial'), 'partial download bytes');
  finalizeFixture(fixture);

  const discovered = discoverShellAssets(fixture.output);
  assert.ok(!discovered.includes('data/archive.pmtiles'));
  assert.ok(!discovered.includes('data/archive.pmtiles.partial'));
});

test('shell discovery returns sorted asset paths', testContext => {
  const fixture = createFixtureProject(testContext);
  buildFixture(fixture);
  const discovered = discoverShellAssets(fixture.output);
  assert.deepEqual(discovered, [...discovered].sort());
});

test('manifest keeps self-inclusion and a stable hash across repeated finalization', testContext => {
  const fixture = createFixtureProject(testContext);
  buildFixture(fixture);
  const firstManifest = fs.readFileSync(path.join(fixture.output, 'data/manifest.json'), 'utf8');
  finalizeFixture(fixture);
  assert.equal(fs.readFileSync(path.join(fixture.output, 'data/manifest.json'), 'utf8'), firstManifest);

  const manifest = readFixtureManifest(fixture);
  assert.equal(manifest.shell.filter(asset => asset === 'data/manifest.json').length, 1);
  const offlineScript = fs.readFileSync(path.join(fixture.output, 'offline-manifest.js'), 'utf8');
  assert.match(offlineScript, /^self\.KOMPAS_OFFLINE=/);
  const offlineData = JSON.parse(offlineScript.slice('self.KOMPAS_OFFLINE='.length).trim().replace(/;$/, ''));
  assert.deepEqual(offlineData.shell, manifest.shell);
  assert.equal(offlineData.shellCache, manifest.shellCache);

  const hashedAssets = [...manifest.shell.filter(asset => asset !== 'data/manifest.json'), 'sw.js'];
  const contents = hashedAssets.map(asset => fs.readFileSync(path.join(fixture.output, asset)));
  const shellHash = crypto.createHash('sha256').update(Buffer.concat(contents)).digest('hex').slice(0, 16);
  assert.equal(manifest.shellCache, `kompas-shell-${shellHash}-${manifest.archive.sha256.slice(0, 8)}`);
  const totalBytes = manifest.shell
    .filter(asset => asset !== 'data/manifest.json')
    .reduce((sum, asset) => sum + fs.statSync(path.join(fixture.output, asset)).size, manifest.archive.bytes);
  assert.equal(manifest.totalBytes, totalBytes);
});

test('offline module check reports a missing runtime module but exempts the service worker', () => {
  assert.doesNotThrow(() => assertShellIncludesModules(['app.js', 'sw.js'], ['app.js']));
  assert.throws(
    () => assertShellIncludesModules(['app.js', 'new-module.js', 'sw.js'], ['app.js']),
    /new-module\.js/
  );
});
