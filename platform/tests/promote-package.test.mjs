import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Runs the real script with a stand-in npm, so the promotion's own rules are tested without any registry.
const promoteScript = fileURLToPath(new URL('../../.github/actions/promote-package/promote.sh', import.meta.url));
const commit = 'a'.repeat(40);
const sourceVersion = `0.0.0-dev.${commit}`;

function writeTarball(directory, {version = sourceVersion, extraFile} = {}) {
  const dependencies = {'some-library': '1.0.0'};
  const packageDirectory = path.join(directory, 'tarball/package');
  fs.mkdirSync(path.join(packageDirectory, 'src'), {recursive: true});
  fs.writeFileSync(path.join(packageDirectory, 'src/index.js'), 'export const value = 1;\n');
  fs.writeFileSync(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({name: '@scope/core', version, dependencies})
  );
  if (extraFile) fs.writeFileSync(path.join(packageDirectory, extraFile), 'extra');
  execFileSync('tar', ['-czf', path.join(directory, 'core.tgz'), '-C', path.join(directory, 'tarball'), 'package']);
}

// Records each publish, and copies the tarball on pack. A failing pack stands for a dev package that does not exist.
function writeFakeNpm(directory, {isPackAvailable = true, tamperWith} = {}) {
  const binDirectory = path.join(directory, 'bin');
  fs.mkdirSync(binDirectory);
  const fakeNpm = `#!/usr/bin/env bash
case "$1" in
  pack)
    ${isPackAvailable ? '' : 'exit 1'}
    echo "$*" >> "${directory}/pack-calls"
    cp "${directory}/core.tgz" core.tgz
    echo core.tgz
    ;;
  pkg)
    version="\${3#version=}"
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version=process.argv[1];${tamperWith ?? ''}fs.writeFileSync('package.json',JSON.stringify(p))" "$version"
    ;;
  publish)
    echo "$* version=$(node -p "require('./package.json').version")" >> "${directory}/publish-calls"
    ;;
esac
`;
  fs.writeFileSync(path.join(binDirectory, 'npm'), fakeNpm, {mode: 0o755});
  return binDirectory;
}

function promote(testContext, {version, flags = '', npmOptions, tarballOptions} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-promote-'));
  testContext.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  writeTarball(directory, tarballOptions);
  const binDirectory = writeFakeNpm(directory, npmOptions);
  const result = spawnSync('bash', [promoteScript], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      PACKAGE_NAME: '@scope/core',
      RELEASE_VERSION: version,
      RELEASE_COMMIT: commit,
      PUBLISH_FLAGS: flags,
      NODE_AUTH_TOKEN: 'test-token',
      GITHUB_STEP_SUMMARY: ''
    }
  });
  const publishLog = path.join(directory, 'publish-calls');
  const publishCalls = fs.existsSync(publishLog) ? fs.readFileSync(publishLog, 'utf8') : '';
  const packCalls = fs.readFileSync(path.join(directory, 'pack-calls'), {encoding: 'utf8', flag: 'a+'});
  return {...result, publishCalls, packCalls};
}

test('a release publishes the dev package of its commit, under its version, as latest', testContext => {
  const {status, publishCalls, packCalls, stderr} = promote(testContext, {version: '1.2.0'});
  assert.equal(status, 0, stderr);
  assert.match(packCalls, new RegExp(`@scope/core@${sourceVersion}`));
  assert.match(publishCalls, /--tag latest/);
  assert.match(publishCalls, /version=1\.2\.0/);
});

test('a prerelease goes to next, so that a plain install can never get it', testContext => {
  const {status, publishCalls} = promote(testContext, {version: '1.3.0-rc.1'});
  assert.equal(status, 0);
  assert.match(publishCalls, /--tag next/);
  assert.match(publishCalls, /version=1\.3\.0-rc\.1/);
});

test('a test run reaches npm with its dry-run flag, through the same steps', testContext => {
  const {status, publishCalls} = promote(testContext, {version: '1.2.0', flags: '--dry-run'});
  assert.equal(status, 0);
  assert.match(publishCalls, /--dry-run/);
});

test('promoting also refuses a change to a nested value, such as a dependency', testContext => {
  const {status, stdout, publishCalls} = promote(testContext, {
    version: '1.2.0',
    npmOptions: {tamperWith: "p.dependencies['some-library']='9.9.9';"}
  });
  assert.notEqual(status, 0);
  assert.match(stdout, /more of package\.json than its version/);
  assert.equal(publishCalls, '');
});

test('a commit CI never built cannot be released', testContext => {
  const {status, stdout, publishCalls} = promote(testContext, {version: '1.2.0', npmOptions: {isPackAvailable: false}});
  assert.notEqual(status, 0);
  assert.match(stdout, /No dev package/);
  assert.equal(publishCalls, '');
});

test('promoting refuses to change anything in package.json but the version', testContext => {
  const {status, stdout, publishCalls} = promote(testContext, {
    version: '1.2.0',
    npmOptions: {tamperWith: "p.scripts={postinstall:'evil'};"}
  });
  assert.notEqual(status, 0);
  assert.match(stdout, /more of package\.json than its version/);
  assert.equal(publishCalls, '');
});
