#!/usr/bin/env node
// Selects and runs the GitHub test runs that a workflow change needs. The pure selectors are shared with ci-plan; the
// command path dispatches CD workflows, which GitHub does not allow a PR to call as reusable workflows.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const CALLABLE_CI_WORKFLOWS = [
  'ci-apps-core-demo.yml',
  'ci-apps-editor.yml',
  'ci-apps-web.yml',
  'ci-backend.yml',
  'ci-browser-image.yml',
  'ci-contracts.yml',
  'ci-data.yml',
  'ci-docs.yml',
  'ci-map-core.yml',
  'ci-platform.yml',
  'ci-publish.yml',
  'ci-tests.yml',
  'ci-transit-relay.yml',
  'ci-workflows.yml'
];

// ci-pr-checks cannot call itself, and ci-nightly calls it, so GitHub would reject both reusable calls as cycles.
export const MANUAL_CI_WORKFLOWS = ['ci-nightly.yml', 'ci-pr-checks.yml'];

export const CD_WORKFLOWS = [
  'cd-browser-image.yml',
  'cd-dev-pages.yml',
  'cd-map-contracts.yml',
  'cd-map-data.yml',
  'cd-map-core.yml'
];

const PACKAGE_WORKFLOWS = [
  'cd-map-contracts.yml',
  'cd-map-data.yml',
  'cd-map-core.yml'
];

const PACKAGE_BY_WORKFLOW = {
  'cd-map-contracts.yml': 'map-contracts',
  'cd-map-data.yml': 'map-data',
  'cd-map-core.yml': 'map-core'
};

const IMAGE_BY_WORKFLOW = {
  'cd-browser-image.yml': 'browser-ci',
  'cd-dev-pages.yml': 'dev-pages'
};

// A shared action is tested through one workflow that really executes it. A change to an action used by every job keeps
// the long-standing ci-pr-checks manual path instead of paying for a test run of every folder workflow.
const ACTION_WORKFLOWS = {
  'install-dependencies': ['ci-apps-editor.yml', 'ci-apps-web.yml'],
  plan: ['ci-publish.yml'],
  'promote-browser-image': ['cd-browser-image.yml'],
  'promote-package': PACKAGE_WORKFLOWS,
  'publish-browser-image': ['ci-publish.yml'],
  'publish-dev-package': ['ci-publish.yml'],
  'publish-image': ['ci-publish.yml'],
  'resolve-release': [...PACKAGE_WORKFLOWS, 'cd-browser-image.yml'],
  'run-check': ['ci-publish.yml'],
  'setup-go': ['ci-backend.yml'],
  'setup-web': ['ci-publish.yml'],
  test_run: ['cd-dev-pages.yml'],
  'validate-commit': ['ci-publish.yml', 'cd-dev-pages.yml']
};

const PLANNER_FILES = [
  'platform/tests/ci-plan.test.mjs',
  'platform/tests/workflow-test-runs.test.mjs',
  'platform/tools/ci-plan.mjs',
  'platform/tools/workflow-test-runs.mjs'
];

const DEV_IMAGE_REPOSITORY = 'ghcr.io/ivanov-gv/cg-map';
const TEST_IMAGE_REPOSITORY = 'ttl.sh/ivanov-gv-cg-map';

function inOrder(selected, order) {
  const known = order.filter(name => selected.has(name));
  const unknown = [...selected].filter(name => !order.includes(name)).sort();
  return [...known, ...unknown];
}

function addWorkflow(sets, workflow) {
  if (CALLABLE_CI_WORKFLOWS.includes(workflow)) {
    sets.ci.add(workflow);
  } else if (MANUAL_CI_WORKFLOWS.includes(workflow)) {
    sets.manual.add(workflow);
  } else if (CD_WORKFLOWS.includes(workflow)) {
    sets.cd.add(workflow);
  } else {
    // A workflow added in this PR cannot be dispatched until it has landed on main.
    sets.manual.add(workflow);
  }
}

// Returns the workflows whose test-run mode proves a changed file. Empty lists mean no extra run is needed.
export function selectWorkflowTestRuns(changedFiles) {
  const sets = {ci: new Set(), cd: new Set(), manual: new Set()};
  for (const file of changedFiles) {
    const workflow = file.startsWith('.github/workflows/') && file.endsWith('.yml') ? file.split('/').pop() : '';
    if (workflow) {
      addWorkflow(sets, workflow);
      continue;
    }
    const action = /^\.github\/actions\/([^/]+)\//.exec(file)?.[1];
    if (action) {
      for (const name of ACTION_WORKFLOWS[action] ?? []) addWorkflow(sets, name);
      continue;
    }
    if (PLANNER_FILES.includes(file)) {
      // The planner is shared by both top-level workflows; only ci-publish has a test-run branch to prove it.
      sets.ci.add('ci-publish.yml');
      sets.manual.add('ci-pr-checks.yml');
      continue;
    }
    if (file.startsWith('.github/') && !file.endsWith('.md')) sets.manual.add('ci-pr-checks.yml');
  }
  return {
    ci: inOrder(sets.ci, CALLABLE_CI_WORKFLOWS),
    cd: inOrder(sets.cd, CD_WORKFLOWS),
    manual: inOrder(sets.manual, MANUAL_CI_WORKFLOWS)
  };
}

function manualTestRunReason(workflow) {
  if (MANUAL_CI_WORKFLOWS.includes(workflow)) return 'a reusable call would form a cycle';
  return 'not on main yet, so it cannot be dispatched';
}

export function formatWorkflowTestRuns({ci, cd, manual}) {
  const manualRuns = manual.map(workflow => `${workflow} (${manualTestRunReason(workflow)})`).join(', ') || 'none';
  return [
    `- CI test-run calls: ${ci.join(', ') || 'none'}`,
    `- CD test-run dispatches: ${cd.join(', ') || 'none'}`,
    `- Manual test runs: ${manualRuns}`
  ].join('\n');
}

// A GitHub run id is unique, so a test version made from it never collides with an earlier attempt.
export function packageTestVersion(runId) {
  const id = String(runId);
  if (!/^\d+$/.test(id)) throw new Error(`run id must be numeric: ${id}`);
  return `0.0.0-test.${id}`;
}

// promote-browser-image requires the Playwright version in the image and a revision after it.
export function browserImageTestVersion(playwrightVersion, runId) {
  if (!/^\d+\.\d+\.\d+$/.test(playwrightVersion))
    throw new Error(`playwright version must be three numbers: ${playwrightVersion}`);
  return `${playwrightVersion}-r${String(runId)}`;
}

// A head commit normally has no dev artifact, because publishing happens on main. Fall back to the newest available
// main commit and say so; the caller has already checked that each candidate has the artifact this workflow promotes.
export function chooseSourceCommit({headCommit, headHasArtifact, mainCommitsWithArtifact}) {
  if (headHasArtifact) return {commit: headCommit, isFallback: false};
  const fallback = mainCommitsWithArtifact.find(commit => commit !== headCommit);
  return {commit: fallback ?? '', isFallback: Boolean(fallback)};
}

export function findDispatchedRun(runs, {headCommit, marker, minimumId = 0}) {
  return runs.find(
    run =>
      Number(run.databaseId) > minimumId &&
      run.headSha === headCommit &&
      String(run.displayTitle).includes(marker)
  );
}

export function playwrightVersionFromLock(lockText) {
  const version = JSON.parse(lockText).packages?.['node_modules/playwright']?.version;
  if (!version) throw new Error('package-lock.json has no pinned Playwright version');
  return version;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function report(line) {
  console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) fs.appendFileSync(summaryPath, `${line}\n`);
}

function commandSucceeds(command, args, options = {}) {
  try {
    execFileSync(command, args, {stdio: 'pipe', ...options});
    return true;
  } catch {
    return false;
  }
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, {encoding: 'utf8', env: process.env}));
}

function hasWorkflowDispatch(workflowText) {
  return /^\s{2}workflow_dispatch:/m.test(workflowText);
}

function hasDispatchInput(workflowText, inputName) {
  const dispatchMatch = workflowText.match(/^\s{2}workflow_dispatch:\s*$/m);
  if (!dispatchMatch) return false;
  const start = dispatchMatch.index + dispatchMatch[0].length;
  const nextTopLevel = workflowText.slice(start).search(/^\s{2}\S/m);
  const section = workflowText.slice(start, nextTopLevel < 0 ? undefined : start + nextTopLevel);
  return new RegExp(`^\\s{6}${inputName}:\\s*$`, 'm').test(section);
}


function commandFailureText(error) {
  return `${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? ''}`;
}

export function dispatchAvailability(workflow, {errorText, content, cause}) {
  if (errorText) {
    if (errorText.includes('HTTP 404')) return {available: false, reason: `${workflow} is not on main yet`};
    throw new Error(`Could not look up ${workflow}: ${errorText}`, {cause});
  }
  if (!hasWorkflowDispatch(content))
    return {available: false, reason: `${workflow} on main has no workflow_dispatch trigger`};
  const missingInput = ['test_run', 'commit'].find(input => !hasDispatchInput(content, input));
  if (missingInput) return {available: false, reason: `${workflow} on main has no ${missingInput} dispatch input`};
  return {available: true, reason: ''};
}

function workflowDispatchAvailability(workflow) {
  const repository = requireEnv('GH_REPO');
  let encoded;
  try {
    encoded = execFileSync(
      'gh',
      ['api', `repos/${repository}/contents/.github/workflows/${workflow}`, '--jq', '.content'],
      {encoding: 'utf8', env: process.env}
    );
  } catch (error) {
    return dispatchAvailability(workflow, {errorText: commandFailureText(error), cause: error});
  }
  return dispatchAvailability(workflow, {content: Buffer.from(encoded.trim(), 'base64').toString('utf8')});
}

function hasSuccessfulTestRun(workflow, headCommit) {
  const runs = ghJson([
    'run',
    'list',
    '--workflow',
    workflow,
    '--event',
    'workflow_dispatch',
    '--commit',
    headCommit,
    '--status',
    'success',
    '--json',
    'displayTitle',
    '--limit',
    '20'
  ]);
  return runs.some(run => isTestRunTitle(run.displayTitle));
}

export function isTestRunTitle(title) {
  return /\btest_run=true\b/.test(String(title));
}

function packageExists(packageName, commit) {
  const token = requireEnv('GH_TOKEN');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-package-check-'));
  const userConfig = path.join(directory, '.npmrc');
  fs.writeFileSync(userConfig, `//npm.pkg.github.com/:_authToken=${token}\n`, {mode: 0o600});
  const args = [
    'view',
    `@ivanov-gv/${packageName}@0.0.0-dev.${commit}`,
    'version',
    '--registry',
    'https://npm.pkg.github.com',
    '--userconfig',
    userConfig
  ];
  try {
    return commandSucceeds('npm', args, {env: process.env});
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

function loginToGithubRegistry() {
  execFileSync(
    'docker',
    ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR || 'github-actions', '--password-stdin'],
    {input: requireEnv('GH_TOKEN'), env: process.env}
  );
}

function imageExists(name, commit) {
  return commandSucceeds('docker', ['manifest', 'inspect', `${DEV_IMAGE_REPOSITORY}/${name}:${commit}`], {
    env: process.env
  });
}

function artifactExists(workflow, commit) {
  const packageName = PACKAGE_BY_WORKFLOW[workflow];
  if (packageName) return packageExists(packageName, commit);
  const imageName = IMAGE_BY_WORKFLOW[workflow];
  return Boolean(imageName && imageExists(imageName, commit));
}

function recentMainCommits() {
  const runs = ghJson([
    'run',
    'list',
    '--workflow',
    'ci-publish.yml',
    '--branch',
    'main',
    '--status',
    'success',
    '--json',
    'headSha',
    '--limit',
    '10'
  ]);
  return [...new Set(runs.map(run => run.headSha).filter(Boolean))];
}

function sourceCommitFor(workflow, headCommit, mainCommits) {
  const choice = chooseSourceCommit({
    headCommit,
    headHasArtifact: artifactExists(workflow, headCommit),
    mainCommitsWithArtifact: mainCommits.filter(commit => commit !== headCommit && artifactExists(workflow, commit))
  });
  if (!choice.commit) throw new Error(`${workflow}: no dev artifact exists for ${headCommit} or a recent main commit`);
  return choice;
}

// The CD test run reads from the temporary registry, so copy the dev image there without changing it.
function prepareTestImage(name, commit) {
  const source = `${DEV_IMAGE_REPOSITORY}/${name}:${commit}`;
  const destination = `${TEST_IMAGE_REPOSITORY}/${name}:${commit}`;
  execFileSync('docker', ['pull', '--quiet', source], {env: process.env});
  execFileSync('docker', ['tag', source, destination], {env: process.env});
  execFileSync('docker', ['push', '--quiet', destination], {env: process.env});
}

export function dispatchArguments(workflow, branch, {commit, marker}) {
  const args = ['workflow', 'run', workflow, '--ref', branch, '-f', 'test_run=true', '-f', `commit=${commit}`];
  // cd-dev-pages has no version input; a test id gives its run a unique title to wait for.
  const versionInput = workflow === 'cd-dev-pages.yml' ? 'test_id' : 'version';
  args.push('-f', `${versionInput}=${marker}`);
  return args;
}

function testMarkerFor(workflow, {playwrightVersion, runId}) {
  if (workflow === 'cd-browser-image.yml') return browserImageTestVersion(playwrightVersion, runId);
  if (workflow === 'cd-dev-pages.yml') return `${runId}-${workflow.replace(/\W/g, '-')}`;
  return packageTestVersion(runId);
}

function dispatch(workflow, branch, {commit, marker}) {
  const before = ghJson(['run', 'list', '--workflow', workflow, '--json', 'databaseId', '--limit', '30']);
  const minimumId = Math.max(0, ...before.map(run => Number(run.databaseId) || 0));
  execFileSync('gh', dispatchArguments(workflow, branch, {commit, marker}), {env: process.env});
  return minimumId;
}

function waitForDispatchedRuns(pending) {
  const timeoutMs = Number(process.env.WAIT_TIMEOUT_SECONDS || 1500) * 1000;
  const intervalSeconds = Number(process.env.POLL_INTERVAL_SECONDS || 15);
  const deadline = Date.now() + timeoutMs;
  const remaining = new Map(pending.map(item => [item.workflow, item]));
  const failures = [];

  while (remaining.size && Date.now() < deadline) {
    for (const [workflow, item] of remaining) {
      const runs = ghJson([
        'run',
        'list',
        '--workflow',
        workflow,
        '--event',
        'workflow_dispatch',
        '--json',
        'databaseId,displayTitle,headSha,status,conclusion,url',
        '--limit',
        '30'
      ]);
      const run = findDispatchedRun(runs, item);
      if (!run || run.status !== 'completed') continue;
      remaining.delete(workflow);
      if (run.conclusion === 'success') {
        report(`${workflow}: test run ${run.databaseId} passed.`);
      } else {
        failures.push(`${workflow}: ${run.conclusion} (${run.url})`);
      }
    }
    if (remaining.size) execFileSync('sleep', [String(intervalSeconds)], {stdio: 'ignore'});
  }

  if (remaining.size) {
    failures.push(`${[...remaining.keys()].join(', ')}: still running after ${timeoutMs / 1000} seconds`);
  }
  if (failures.length) throw new Error(`CD test runs failed: ${failures.join('; ')}`);
}

function main() {
  const workflows = JSON.parse(process.env.CD_TEST_RUNS || '[]');
  if (!Array.isArray(workflows)) throw new Error('CD_TEST_RUNS must be a JSON array of workflow file names');
  if (workflows.length === 0) {
    report('No changed CD workflows need a test run.');
    return;
  }
  for (const workflow of workflows) {
    if (!CD_WORKFLOWS.includes(workflow)) throw new Error(`Unsupported CD workflow: ${workflow}`);
  }

  const headCommit = requireEnv('HEAD_SHA');
  const branch = requireEnv('BRANCH');
  const runId = requireEnv('RUN_ID');
  const playwrightVersion = playwrightVersionFromLock(fs.readFileSync('package-lock.json', 'utf8'));
  const needsImage = workflows.some(workflow => IMAGE_BY_WORKFLOW[workflow]);
  if (needsImage) loginToGithubRegistry();
  const mainCommits = recentMainCommits();
  const pending = [];
  for (const workflow of workflows) {
    if (hasSuccessfulTestRun(workflow, headCommit)) {
      report(`${workflow}: reusing the successful test run for ${headCommit}.`);
      continue;
    }
    const availability = workflowDispatchAvailability(workflow);
    if (!availability.available) {
      report(`${workflow}: exempt — ${availability.reason}, so it cannot be dispatched.`);
      continue;
    }
    const source = sourceCommitFor(workflow, headCommit, mainCommits);
    if (source.isFallback)
      report(
        `${workflow}: no dev package or image exists for ${headCommit}; using ${source.commit}, the newest main commit with one.`
      );
    const imageName = IMAGE_BY_WORKFLOW[workflow];
    if (imageName) prepareTestImage(imageName, source.commit);
    const marker = testMarkerFor(workflow, {playwrightVersion, runId});
    const minimumId = dispatch(workflow, branch, {commit: source.commit, marker});
    pending.push({workflow, headCommit, marker, minimumId});
    report(`${workflow}: dispatched test_run=true with ${marker}.`);
  }

  waitForDispatchedRuns(pending);
  report(`CD test-run check passed for ${workflows.length} changed workflow(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
