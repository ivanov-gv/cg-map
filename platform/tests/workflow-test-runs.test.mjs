import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserImageTestVersion,
  chooseSourceCommit,
  dispatchArguments,
  dispatchAvailability,
  findDispatchedRun,
  formatWorkflowTestRuns,
  isTestRunTitle,
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

test('selection: planner changes keep the ci-pr-checks manual path', () => {
  const selection = selectWorkflowTestRuns([
    'platform/tools/ci-plan.mjs',
    'platform/tools/workflow-test-runs.mjs',
    'platform/tests/workflow-test-runs.test.mjs'
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

test('source commit uses head when it has an artifact, otherwise the newest main commit', () => {
  const head = '1111111111111111111111111111111111111111';
  const main = '2222222222222222222222222222222222222222';
  assert.deepEqual(
    chooseSourceCommit({headCommit: head, headHasArtifact: true, mainCommitsWithArtifact: [main]}),
    {commit: head, isFallback: false}
  );
  assert.deepEqual(
    chooseSourceCommit({headCommit: head, headHasArtifact: false, mainCommitsWithArtifact: [main]}),
    {commit: main, isFallback: true}
  );
  assert.deepEqual(
    chooseSourceCommit({headCommit: head, headHasArtifact: false, mainCommitsWithArtifact: [head]}),
    {commit: '', isFallback: false}
  );
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
