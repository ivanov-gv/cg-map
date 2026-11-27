import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import path from 'node:path';
import {createFixtureProject, runFixtureTool} from './fixture-project.mjs';
import {pinnedCoreRoot} from './pinned-core.mjs';

function assertBuildFailed(result) {
  assert.notEqual(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
}

test('a release build refuses a core, data or contracts root outside its pins', testContext => {
  const fixture = createFixtureProject(testContext);
  const rejectedRoots = [
    ['MAP_CORE_ROOT', fixture.localCore, /release build must bundle the pinned @ivanov-gv\/map-core/],
    ['MAP_CORE_ROOT', '', /MAP_CORE_ROOT is set but empty/],
    ['MAP_DATA_ROOT', path.join(fixture.root, 'data'), /release build must bundle the pinned @ivanov-gv\/map-data/],
    [
      'MAP_CONTRACTS_ROOT',
      path.join(fixture.root, 'other-contracts'),
      /release build must bundle the pinned @ivanov-gv\/map-contracts/
    ]
  ];
  for (const [name, value, expectedError] of rejectedRoots) {
    const result = runFixtureTool(fixture, 'build.mjs', [], {
      WEB_RELEASE: '1',
      MAP_CORE_ROOT: pinnedCoreRoot,
      [name]: value
    });
    assertBuildFailed(result);
    assert.match(result.stderr, expectedError);
  }
});

test('a default build takes map-core from this commit', testContext => {
  const fixture = createFixtureProject(testContext);
  fileSystem.appendFileSync(path.join(fixture.localCore, 'src/index.js'), '\nexport const localCoreMarker = true;\n');
  const result = runFixtureTool(fixture, 'build.mjs');
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const builtCore = fileSystem.readFileSync(path.join(fixture.output, 'map-core/index.js'), 'utf8');
  assert.match(builtCore, /localCoreMarker/);
});

test('automated tests and the release target build from the pinned core', () => {
  const makefile = fileSystem.readFileSync(new URL('../Makefile', import.meta.url), 'utf8');
  assert.match(
    makefile,
    /^verify test test-built offline-check e2e e2e-built build-release build-pinned-core: export MAP_CORE_ROOT = /m
  );
  assert.match(makefile, /^build-pinned-core:\n\tnpm run build$/m);
  assert.match(makefile, /^build-release:\n\tWEB_RELEASE=1 npm run build$/m);
  const appPackage = JSON.parse(fileSystem.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(appPackage.scripts.pretest, /MAP_CORE_ROOT="\$\(node tests\/pinned-core\.mjs\)"/);
  assert.match(appPackage.scripts['pretest:e2e'], /MAP_CORE_ROOT="\$\(node tests\/pinned-core\.mjs\)"/);
  assert.equal(appPackage.scripts['release:prepare'], 'make build-release');
  const browserConfig = fileSystem.readFileSync(new URL('../playwright.config.mjs', import.meta.url), 'utf8');
  assert.match(browserConfig, /MAP_CORE_ROOT \?\?= pinnedCoreRoot/);
});
