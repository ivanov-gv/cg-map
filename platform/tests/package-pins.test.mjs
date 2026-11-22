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
const contractsPackageName = '@ivanov-gv/map-contracts';
const exactVersionPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const readJSON = relativePath => JSON.parse(fileSystem.readFileSync(`${repositoryRoot}${relativePath}`));
const lockedPackages = readJSON('package-lock.json').packages;

// Returns the lock key for a workspace's installed package, preferring its local copy over the hoisted root copy.
function lockedPackagePath(workspace, packageName) {
  const rootLockPath = `node_modules/${packageName}`;
  if (!workspace) return rootLockPath;
  const workspaceLockPath = `${workspace}/node_modules/${packageName}`;
  return lockedPackages[workspaceLockPath] ? workspaceLockPath : rootLockPath;
}

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

test('every consumer pins its own exact published contracts release, never the local package', () => {
  const consumerWorkspaces = [
    '',
    'apps/web',
    'apps/editor',
    'apps/core-demo',
    'packages/map-core',
    'platform'
  ];
  for (const workspace of consumerWorkspaces) {
    const manifest = workspace ? `${workspace}/package.json` : 'package.json';
    assertRegistryPin(
      manifest,
      lockedPackagePath(workspace, contractsPackageName),
      contractsPackageName,
      'devDependencies'
    );
  }
  assert.equal(readJSON('packages/contracts/package.json').version, '0.0.0-dev');
  assert.ok(
    !readJSON('package.json').workspaces.includes('packages/contracts'),
    'npm must not link the unpublished HEAD package into consumers'
  );
});

const pinnedContractsAssignment = 'MAP_CONTRACTS_ROOT="$(node tests/pinned-contracts.mjs)"';

for (const application of ['apps/web', 'apps/editor', 'apps/core-demo']) {
  test(`${application} builds HEAD contracts and tests resolve the app pin`, () => {
    const makefile = fileSystem.readFileSync(path.join(repositoryRoot, application, 'Makefile'), 'utf8');
    const dataTargets = makefile.match(/^(.+): export MAP_DATA_ROOT/m)?.[1];
    const contractsTargets = makefile.match(/^(.+): export MAP_CONTRACTS_ROOT/m)?.[1];
    assert.ok(dataTargets, `${application}/Makefile must pin data in test targets`);
    assert.equal(contractsTargets, dataTargets, 'contracts and data must use the same test targets');

    const appPackage = readJSON(`${application}/package.json`);
    assert.equal(appPackage.scripts.build, 'node tools/build.mjs', 'dev builds must keep repository contracts');
    const buildSource = fileSystem.readFileSync(path.join(repositoryRoot, application, 'tools/build.mjs'), 'utf8');
    assert.match(buildSource, /resolveContractsRoot\(\)/);
    assert.doesNotMatch(buildSource, /import\.meta\.resolve\(['"]@ivanov-gv\/map-contracts/);

    const helper = fileSystem.readFileSync(path.join(repositoryRoot, application, 'tests/pinned-contracts.mjs'), 'utf8');
    assert.match(helper, /import\.meta\.resolve\('@ivanov-gv\/map-contracts\/package\.json'\)/);
    const browserConfig = fileSystem.readFileSync(path.join(repositoryRoot, application, 'playwright.config.mjs'), 'utf8');
    assert.match(browserConfig, /MAP_CONTRACTS_ROOT \?\?= pinnedContractsRoot/);
    const lifecycleBuilds = ['pretest', 'pretest:built', 'pretest:e2e'].filter(name => appPackage.scripts[name]);
    assert.ok(lifecycleBuilds.length > 0, 'a test lifecycle must build from the pinned contracts');
    for (const name of lifecycleBuilds) {
      assert.ok(
        appPackage.scripts[name].includes(pinnedContractsAssignment),
        `${application} ${name} must set MAP_CONTRACTS_ROOT before building`
      );
    }
    if (appPackage.scripts['check:offline']) {
      assert.ok(appPackage.scripts['check:offline'].includes(pinnedContractsAssignment));
    }
  });
}

test('platform resolves contracts from the pinned package, not repository sources', () => {
  const resolved = execFileSync('node', ['platform/tools/pinned-contracts-root.mjs'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  }).trim();
  assert.match(resolved, /node_modules\/@ivanov-gv\/map-contracts$/);
  assert.notEqual(resolved, path.join(repositoryRoot, 'packages/contracts'));
});

test('the map-data package ships every path its consumers read', () => {
  const mapData = readJSON('data/package.json');
  const dataTools = [
    'tools/app-data.mjs',
    'tools/apply-changeset.mjs',
    'tools/apply-place-visibility.mjs',
    'tools/building-entrances.mjs',
    'tools/check-data.mjs',
    'tools/contracts.mjs',
    'tools/editor-bundle.mjs',
    'tools/entity-identity.mjs'
  ];
  for (const file of [
    'sources',
    'artifacts',
    'imagery',
    'PROVENANCE.md',
    'tests/fixtures',
    ...dataTools
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
    ...dataTools.map(file => `./${file}`)
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

test('web built-artifact browser tests use dist/web as-is', () => {
  const webPackage = readJSON('apps/web/package.json');
  assert.equal(webPackage.scripts['pretest:built'], undefined, 'a hidden rebuild would ignore the built artifact');
  assert.equal(webPackage.scripts['test:e2e:built'], 'playwright test');
});

test('web build and offline finalizer share one data-root resolver', () => {
  assert.ok(fileSystem.existsSync(`${repositoryRoot}apps/web/tools/data-root.mjs`));
  for (const tool of ['build.mjs', 'finalize.mjs']) {
    const source = fileSystem.readFileSync(`${repositoryRoot}apps/web/tools/${tool}`, 'utf8');
    assert.match(source, /import \{resolveDataRoot\} from '\.\/data-root\.mjs'/);
    assert.doesNotMatch(source, /function resolveDataRoot/);
  }
});
