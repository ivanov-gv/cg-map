import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

// The isolation between core and the apps rests on these. npm links a workspace package whenever its version satisfies a
// dependency, so a wrong pin or version would silently put an app back on unreleased core with no other symptom.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const packageName = '@ivanov-gv/map-core';
const readJSON = relativePath => JSON.parse(fs.readFileSync(`${repositoryRoot}${relativePath}`));
const lockedPackages = readJSON('package-lock.json').packages;
const exactVersionPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

for (const application of ['apps/web', 'apps/editor']) {
  test(`${application} pins an exact released core, from the registry`, () => {
    const pinnedVersion = readJSON(`${application}/package.json`).dependencies[packageName];
    assert.match(pinnedVersion, exactVersionPattern);
    assert.doesNotMatch(pinnedVersion, /-dev/);
    const locked = lockedPackages[`${application}/node_modules/${packageName}`];
    assert.ok(locked, `${application} must have its own copy, not the workspace link`);
    assert.equal(locked.version, pinnedVersion);
    assert.equal(locked.link, undefined);
    assert.match(locked.resolved, /^https:\/\/npm\.pkg\.github\.com\//);
    assert.ok(locked.integrity, 'the lockfile must verify what it downloads');
  });
}

test('apps/core-demo uses local core, because it is core dev environment', () => {
  assert.equal(readJSON('apps/core-demo/package.json').dependencies[packageName], '0.0.0-dev');
  assert.equal(lockedPackages[`node_modules/${packageName}`].link, true);
  assert.equal(lockedPackages[`node_modules/${packageName}`].resolved, 'packages/map-core');
});

test('core in this repository can never satisfy an app pin', () => {
  assert.equal(readJSON('packages/map-core/package.json').version, '0.0.0-dev');
});

test('the map-data package ships every path its consumers read', () => {
  const mapData = readJSON('data/package.json');
  for (const file of [
    'sources',
    'artifacts',
    'imagery',
    'PROVENANCE.md',
    'tests/fixtures',
    'tools/app-data.mjs',
    'tools/editor-bundle.mjs',
    'tools/building-entrances.mjs'
  ]) {
    assert.ok(mapData.files.includes(file), `data/package.json must ship ${file}`);
  }
  for (const exported of [
    './package.json',
    './sources/*',
    './artifacts/*',
    './imagery/*',
    './PROVENANCE.md',
    './tests/fixtures/*',
    './tools/app-data.mjs',
    './tools/editor-bundle.mjs',
    './tools/building-entrances.mjs'
  ]) {
    assert.ok(mapData.exports[exported], `data/package.json must export ${exported}`);
  }
  assert.equal(mapData.license, 'SEE LICENSE IN PROVENANCE.md');
});

const dataPackageName = '@ivanov-gv/map-data';
const pinnedRootAssignment = 'MAP_DATA_ROOT="$(node tests/pinned-data.mjs)"';

for (const application of ['apps/web', 'apps/editor', 'apps/core-demo']) {
  test(`${application} pins map-data and selects it in test lifecycle builds`, () => {
    const appPackage = readJSON(`${application}/package.json`);
    assert.equal(appPackage.devDependencies[dataPackageName], '0.1.0');
    assert.equal(appPackage.scripts.build, 'node tools/build.mjs', 'dev builds must keep the repository data root');

    const lifecycleBuilds = ['pretest', 'pretest:built', 'pretest:e2e'].filter(name => appPackage.scripts[name]);
    assert.ok(lifecycleBuilds.length > 0, 'a test lifecycle must build from the pinned package');
    for (const name of lifecycleBuilds) {
      assert.ok(
        appPackage.scripts[name].includes(pinnedRootAssignment),
        `${application} ${name} must set MAP_DATA_ROOT before building`
      );
    }
    if (appPackage.scripts['check:offline']) {
      assert.ok(appPackage.scripts['check:offline'].includes(pinnedRootAssignment));
    }
  });
}
