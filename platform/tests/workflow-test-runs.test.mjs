import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserImageTestVersion,
  commitFromDevVersion,
  commitFromImageLabels,
  devImageCommands,
  devPackageTarget,
  dispatchArguments,
  dispatchAvailability,
  findDispatchedRun,
  formatWorkflowTestRuns,
  isImageTagMissing,
  isPackageVersionMissing,
  isTestRunTitle,
  npmAuthForRegistry,
  packageTestVersion,
  playwrightVersionFromLock,
  selectWorkflowTestRuns
} from '../tools/workflow-test-runs.mjs';

for (const [name, file, expected] of [
  ['a callable CI workflow', '.github/workflows/ci-apps-web.yml', {ci: ['ci-apps-web.yml'], cd: [], manual: []}],
  ['ci-publish', '.github/workflows/ci-publish.yml', {ci: ['ci-publish.yml'], cd: [], manual: []}],
  ['ci-workflows', '.github/workflows/ci-workflows.yml', {ci: ['ci-workflows.yml'], cd: [], manual: []}],
  ['a CD workflow', '.github/workflows/cd-map-data.yml', {ci: [], cd: ['cd-map-data.yml'], manual: []}],
  ['ci-pr-checks itself', '.github/workflows/ci-pr-checks.yml', {ci: [], cd: [], manual: ['ci-pr-checks.yml']}],
  ['ci-nightly, which would form a cycle', '.github/workflows/ci-nightly.yml', {ci: [], cd: [], manual: ['ci-nightly.yml']}],
  ['a workflow not yet on main', '.github/workflows/cd-new.yml', {ci: [], cd: [], manual: ['cd-new.yml']}]
]) {
  test(`selection: ${name}`, () => {
    assert.deepEqual(selectWorkflowTestRuns([file]), expected);
  });
}

test('selection: one shared action is proved by the workflows that execute it', () => {
  assert.deepEqual(selectWorkflowTestRuns(['.github/actions/promote-package/action.yml']), {
    ci: [],
    cd: ['cd-map-contracts.yml', 'cd-map-data.yml', 'cd-map-core.yml'],
    manual: []
  });
  assert.deepEqual(selectWorkflowTestRuns(['.github/actions/validate-commit/action.yml']), {
    ci: ['ci-publish.yml'],
    cd: ['cd-dev-pages.yml'],
    manual: []
  });
  assert.deepEqual(selectWorkflowTestRuns(['.github/actions/setup-web/action.yml']), {
    ci: ['ci-publish.yml'],
    cd: [],
    manual: []
  });
  assert.deepEqual(selectWorkflowTestRuns(['.github/workflows/ci-apps-web.yml']), {
    ci: ['ci-apps-web.yml'],
    cd: [],
    manual: []
  });
});

test('selection: workflow-test-runs changes are proved by ci-workflows', () => {
  const selection = selectWorkflowTestRuns([
    'platform/tools/workflow-test-runs.mjs',
    'platform/tests/workflow-test-runs.test.mjs'
  ]);
  assert.deepEqual(selection, {ci: ['ci-workflows.yml'], cd: [], manual: []});
});

test('selection: ci-plan changes are proved by workflows that use the plan action', () => {
  const selection = selectWorkflowTestRuns([
    'platform/tools/ci-plan.mjs',
    'platform/tests/ci-plan.test.mjs'
  ]);
  assert.deepEqual(selection, {ci: ['ci-publish.yml'], cd: [], manual: ['ci-pr-checks.yml']});
  assert.match(formatWorkflowTestRuns(selection), /Manual test runs: ci-pr-checks\.yml/);
});

test('manual test runs explain why no automatic proof is possible', () => {
  const cycle = selectWorkflowTestRuns(['.github/workflows/ci-nightly.yml']);
  assert.match(
    formatWorkflowTestRuns(cycle),
    /Manual test runs: ci-nightly\.yml \(a reusable call would form a cycle\)/
  );
  const newWorkflow = selectWorkflowTestRuns(['.github/workflows/cd-new.yml']);
  assert.match(
    formatWorkflowTestRuns(newWorkflow),
    /Manual test runs: cd-new\.yml \(not on main yet, so it cannot be dispatched\)/
  );
});

test('selection: documentation needs no test run, while unknown .github files stay conservative', () => {
  assert.deepEqual(selectWorkflowTestRuns(['.github/TESTING.md', 'docs/verification/testing.md']), {
    ci: [],
    cd: [],
    manual: []
  });
  assert.deepEqual(selectWorkflowTestRuns(['.github/CODEOWNERS']), {
    ci: [],
    cd: [],
    manual: ['ci-pr-checks.yml']
  });
});

test('selection: repeated changes name each workflow once, in a stable order', () => {
  const selection = selectWorkflowTestRuns([
    '.github/workflows/cd-map-core.yml',
    '.github/actions/resolve-release/action.yml',
    '.github/workflows/cd-browser-image.yml'
  ]);
  assert.deepEqual(selection.cd, [
    'cd-browser-image.yml',
    'cd-map-contracts.yml',
    'cd-map-data.yml',
    'cd-map-core.yml'
  ]);
});

test('test versions are unique and follow each registry\'s rules', () => {
  assert.equal(packageTestVersion(43710253591), '0.0.0-test.43710253591');
  assert.equal(browserImageTestVersion('1.56.1', 43710253591), '1.56.1-r43710253591');
  assert.throws(() => packageTestVersion('main'), /numeric/);
  assert.throws(() => browserImageTestVersion('latest', 12), /three numbers/);
});

test('dev package lookups and errors name the same scoped package', () => {
  const target = devPackageTarget('map-core');
  assert.equal(target.spec, '@ivanov-gv/map-core@dev');
  assert.equal(target.missingVersionMessage, 'no dev version published for @ivanov-gv/map-core (tag dev)');
});

test('image labels come from a pulled image, not an OCI index', () => {
  const {image, pull, inspect} = devImageCommands('map-core');
  assert.equal(image, 'ghcr.io/ivanov-gv/cg-map/map-core:dev');
  assert.deepEqual(pull, ['pull', '--quiet', image]);
  assert.deepEqual(inspect, ['image', 'inspect', '--format', '{{json .Config.Labels}}', image]);
});

test('a dev package version names the commit it was published from', () => {
  const commit = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(commitFromDevVersion(`0.0.0-dev.${commit}\n`), commit);
  assert.throws(() => commitFromDevVersion('0.1.0'), /unexpected dev version/);
  assert.throws(() => commitFromDevVersion(`0.0.0-dev.${'A'.repeat(40)}`), /unexpected dev version/);
  assert.throws(() => commitFromDevVersion(`0.0.0-test.${commit}`), /unexpected dev version/);
});

test('an image label names the commit its dev tag was published from', () => {
  const commit = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const labels = {'org.opencontainers.image.revision': commit};
  assert.equal(commitFromImageLabels(JSON.stringify(labels)), commit);
  assert.throws(() => commitFromImageLabels('null'), /missing org\.opencontainers\.image\.revision label/);
  assert.throws(() => commitFromImageLabels('not json'), /unreadable image labels/);
  assert.throws(
    () => commitFromImageLabels(JSON.stringify({'org.opencontainers.image.revision': 'main'})),
    /missing org\.opencontainers\.image\.revision label/
  );
});

test('only a missing npm tag is a missing dev package', () => {
  assert.equal(isPackageVersionMissing('npm error code E404\nnpm error 404 Not Found'), true);
  assert.equal(isPackageVersionMissing('npm error 401 Unauthorized - unauthenticated'), false);
  assert.equal(isPackageVersionMissing('npm error code E403\nnpm error 403 Forbidden'), false);
});

test('a missing image tag is told apart from a registry failure', () => {
  const image = 'ghcr.io/ivanov-gv/cg-map/map-core:dev';
  assert.equal(
    isImageTagMissing(`Error response from daemon: manifest for ${image} not found: manifest unknown`),
    true
  );
  assert.equal(isImageTagMissing('Error response from daemon: manifest unknown'), true);
  assert.equal(
    isImageTagMissing('Error response from daemon: pull access denied for map-core, repository does not exist'),
    false
  );
});

test('auth and network failures are not a missing image tag', () => {
  assert.equal(isImageTagMissing('Error response from daemon: access denied'), false);
  assert.equal(isImageTagMissing('error during connect: dial tcp: lookup docker.example.com: no such host'), false);
  assert.equal(isImageTagMissing('authentication failed: token endpoint returned 404 Not Found'), false);
});

test('npm auth keeps the token in the environment, not the registry config', () => {
  const environment = {PATH: '/usr/bin'};
  const auth = npmAuthForRegistry('secret-token', environment);
  assert.equal(auth.userConfig, '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n');
  assert.equal(auth.env.NODE_AUTH_TOKEN, 'secret-token');
  assert.equal(environment.NODE_AUTH_TOKEN, undefined);
  assert.ok(!auth.userConfig.includes('secret-token'));
});

test('a dispatched run is matched by its new id, head commit, and unique title', () => {
  const head = '1111111111111111111111111111111111111111';
  const runs = [
    {databaseId: 40, headSha: head, displayTitle: 'cd-map-core test_run=true 0.0.0-test.40'},
    {databaseId: 41, headSha: head, displayTitle: 'cd-map-core test_run=true 0.0.0-test.99'},
    {databaseId: 42, headSha: '2222222222222222222222222222222222222222', displayTitle: 'cd-map-core test_run=true 0.0.0-test.99'}
  ];
  const run = findDispatchedRun(runs, {headCommit: head, marker: '0.0.0-test.99', minimumId: 40});
  assert.equal(run.databaseId, 41);
  assert.equal(findDispatchedRun(runs, {headCommit: head, marker: 'other', minimumId: 40}), undefined);
});

test('the browser image test version reads the pinned Playwright version', () => {
  const lock = JSON.stringify({packages: {'node_modules/playwright': {version: '1.56.1'}}});
  assert.equal(playwrightVersionFromLock(lock), '1.56.1');
  assert.throws(() => playwrightVersionFromLock('{}'), /no pinned Playwright/);
});

test('a dispatch command really runs test_run=true with the commit and a unique version', () => {
  const commit = '1111111111111111111111111111111111111111';
  assert.deepEqual(dispatchArguments('cd-map-data.yml', 'feature', {commit, marker: '0.0.0-test.99'}), [
    'workflow', 'run', 'cd-map-data.yml', '--ref', 'feature',
    '-f', 'test_run=true', '-f', `commit=${commit}`, '-f', 'version=0.0.0-test.99'
  ]);
  assert.deepEqual(dispatchArguments('cd-dev-pages.yml', 'feature', {commit, marker: '99-cd-dev-pages'}), [
    'workflow', 'run', 'cd-dev-pages.yml', '--ref', 'feature',
    '-f', 'test_run=true', '-f', `commit=${commit}`, '-f', 'test_id=99-cd-dev-pages'
  ]);
});

test('only a successful run titled test_run=true can be reused', () => {
  assert.equal(isTestRunTitle('cd-map-data test_run=true 0.0.0-test.99'), true);
  assert.equal(isTestRunTitle('cd-map-data test_run=false 0.0.0-test.99'), false);
  assert.equal(isTestRunTitle('other run'), false);
});

test('an unavailable workflow is exempt, but an API failure is not', () => {
  assert.deepEqual(dispatchAvailability('ci-publish.yml', {errorText: 'HTTP 404 NOT FOUND'}), {
    available: false,
    reason: 'ci-publish.yml is not on main yet'
  });
  const withoutDispatch = dispatchAvailability('ci-publish.yml', {content: 'name: ci-publish\non:\n  workflow_call:\n'});
  assert.equal(withoutDispatch.available, false);
  assert.match(withoutDispatch.reason, /no workflow_dispatch trigger/);
  const withoutCommit = dispatchAvailability('ci-publish.yml', {
    content: 'name: ci-publish\non:\n  workflow_dispatch:\n    inputs:\n      test_run:\n        type: boolean\n'
  });
  assert.equal(withoutCommit.available, false);
  assert.match(withoutCommit.reason, /no commit dispatch input/);
  assert.throws(
    () => dispatchAvailability('ci-publish.yml', {errorText: 'error'}),
    /Could not look up ci-publish\.yml/
  );
});
