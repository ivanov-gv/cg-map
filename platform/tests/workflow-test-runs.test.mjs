import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserImageTestVersion,
  dispatchArguments,
  dispatchAvailability,
  findDispatchedRun,
  formatWorkflowTestRuns,
  isPackageVersionMissing,
  isTestRunTitle,
  packageTestVersion,
  playwrightVersionFromLock,
  readMainCommitLog,
  selectWorkflowTestRuns,
  sourceCommitFor
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

test('main history is read from the fetched origin/main ref', () => {
  const commit = '2222222222222222222222222222222222222222';
  const log = `${commit}\n`;
  let call;
  const runGit = (command, args, options) => {
    call = {command, args, options};
    return log;
  };

  assert.equal(readMainCommitLog(runGit), log);
  assert.equal(call.command, 'git');
  assert.deepEqual(call.args, ['log', '--max-count=20', '--format=%H', 'refs/remotes/origin/main']);
  assert.equal(call.options.encoding, 'utf8');
  assert.equal(call.options.env, process.env);
});

test('source commit uses head when it has an artifact, otherwise the newest main commit', () => {
  const headCommit = '1111111111111111111111111111111111111111';
  const mainCommit = '2222222222222222222222222222222222222222';
  const mainCommitLog = `${mainCommit}\n3333333333333333333333333333333333333333`;

  assert.deepEqual(
    sourceCommitFor('cd-map-core.yml', headCommit, mainCommitLog, commit => commit === headCommit),
    {commit: headCommit, isFallback: false}
  );
  assert.deepEqual(
    sourceCommitFor('cd-map-core.yml', headCommit, mainCommitLog, commit => commit === mainCommit),
    {commit: mainCommit, isFallback: true}
  );
  assert.throws(
    () => sourceCommitFor('cd-map-core.yml', headCommit, mainCommitLog, () => false),
    /no dev artifact exists/
  );
});

test('the fallback checks main commits newest first until one has an artifact', () => {
  const headCommit = '1111111111111111111111111111111111111111';
  const commitWithArtifact = '2222222222222222222222222222222222222222';
  const newestCommit = '3333333333333333333333333333333333333333';
  const olderCommit = '4444444444444444444444444444444444444444';
  const checkedCommits = [];
  // Issue #366: run status is no longer an input. A commit can belong to a failed ci-publish run and still have the
  // artifact another job published, so the registry answer is the only evidence the fallback needs.
  const artifactExists = commit => {
    checkedCommits.push(commit);
    return commit === commitWithArtifact;
  };

  const source = sourceCommitFor(
    'cd-map-contracts.yml',
    headCommit,
    `${newestCommit}\n${commitWithArtifact}\n${olderCommit}`,
    artifactExists
  );

  assert.deepEqual(source, {commit: commitWithArtifact, isFallback: true});
  assert.deepEqual(
    checkedCommits,
    [headCommit, newestCommit, commitWithArtifact],
    'checks newest first and stops at the artifact'
  );
});

test('source commit checks at most the newest twenty main commits', () => {
  const commits = Array.from({length: 21}, (_, index) => String(index).padStart(40, '0'));
  const oldestCommit = commits.at(-1);

  assert.throws(
    () => sourceCommitFor('cd-map-core.yml', 'f'.repeat(40), commits.join('\n'), commit => commit === oldestCommit),
    /no dev artifact exists/
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

test('only a not-found npm answer means the dev package is missing', () => {
  assert.equal(isPackageVersionMissing('npm error code E404\nnpm error 404 Not Found'), true);
  assert.equal(isPackageVersionMissing('npm error 401 Unauthorized - unauthenticated'), false);
  assert.equal(isPackageVersionMissing('npm error code E403\nnpm error 403 Forbidden'), false);
});
