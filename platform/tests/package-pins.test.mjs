import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// The isolation between core, data and the apps rests on these pins. npm links a workspace package whenever its version
// satisfies a dependency, so a wrong version or a link would silently put a consumer back on unreleased code.
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const corePackageName = '@ivanov-gv/map-core';
const dataPackageName = '@ivanov-gv/map-data';
const exactVersionPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const readJSON = relativePath => JSON.parse(fileSystem.readFileSync(`${repositoryRoot}${relativePath}`));
const lockedPackages = readJSON('package-lock.json').packages;

function assertRegistryPin(manifestPath, lockPath, packageName, section) {
  const pinnedVersion = readJSON(manifestPath)[section][packageName];
  assert.match(pinnedVersion, exactVersionPattern, `${manifestPath} must pin ${packageName} exactly`);
  assert.doesNotMatch(pinnedVersion, /-dev/);
  const locked = lockedPackages[lockPath];
  assert.ok(locked, `${manifestPath} must have its own copy, not a workspace link`);
  assert.equal(locked.version, pinnedVersion);
  assert.equal(locked.link, undefined);
  assert.match(locked.resolved, /^https:\/\/npm\.pkg\.github\.com\//);
  assert.ok(locked.integrity, 'the lockfile must verify what it downloads');
}

for (const application of ['apps/web', 'apps/editor']) {
  test(`${application} pins an exact released core, from the registry`, () => {
    assertRegistryPin(
      `${application}/package.json`,
      `${application}/node_modules/${corePackageName}`,
      corePackageName,
      'dependencies'
    );
  });
}

test('apps/core-demo uses local core, because it is core dev environment', () => {
  assert.equal(readJSON('apps/core-demo/package.json').dependencies[corePackageName], '0.0.0-dev');
  assert.equal(lockedPackages[`node_modules/${corePackageName}`].link, true);
  assert.equal(lockedPackages[`node_modules/${corePackageName}`].resolved, 'packages/map-core');
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

test('map-data in this repository can never satisfy a pin', () => {
  assert.equal(readJSON('data/package.json').version, '0.0.0-dev');
});

test('platform pins map-data for its hosting tests, from the registry', () => {
  assertRegistryPin(
    'platform/package.json',
    `platform/node_modules/${dataPackageName}`,
    dataPackageName,
    'devDependencies'
  );
});

test('platform resolves map-data from its own pin, not an app', () => {
  const resolved = execFileSync('node', ['platform/tools/pinned-data-root.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).trim();
  assert.equal(resolved, path.join(repositoryRoot, 'platform/node_modules/@ivanov-gv/map-data'));
});

const pinnedRootAssignment = 'MAP_DATA_ROOT="$(node tests/pinned-data.mjs)"';

for (const application of ['apps/web', 'apps/editor', 'apps/core-demo']) {
  test(`${application} pins an exact released map-data, from the registry`, () => {
    assertRegistryPin(
      `${application}/package.json`,
      `${application}/node_modules/${dataPackageName}`,
      dataPackageName,
      'devDependencies'
    );
    const appPackage = readJSON(`${application}/package.json`);
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
