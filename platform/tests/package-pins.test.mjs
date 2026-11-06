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
