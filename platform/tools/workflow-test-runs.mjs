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

// Each planner file is proved by the workflow that executes it, not by every workflow that shares the planner family.
const PLANNER_FILE_WORKFLOWS = {
  'platform/tools/ci-plan.mjs': ['ci-publish.yml', 'ci-pr-checks.yml'],
  'platform/tests/ci-plan.test.mjs': ['ci-publish.yml', 'ci-pr-checks.yml'],
  'platform/tools/workflow-test-runs.mjs': ['ci-workflows.yml'],
  'platform/tests/workflow-test-runs.test.mjs': ['ci-workflows.yml']
};

const DEV_IMAGE_REPOSITORY = 'ghcr.io/ivanov-gv/cg-map';
const TEST_IMAGE_REPOSITORY = 'ttl.sh/ivanov-gv-cg-map';
const DEV_IMAGE_LABEL = 'org.opencontainers.image.revision';
const IMAGE_INSPECT_FORMAT = '{{json .Image}}';
const NPM_REGISTRY_USER_CONFIG = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n';

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
    const plannerWorkflows = PLANNER_FILE_WORKFLOWS[file];
    if (plannerWorkflows) {
      for (const name of plannerWorkflows) addWorkflow(sets, name);
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

// The @dev npm spec and its missing-version error always name the same scoped package.
export function devPackageTarget(packageName) {
  const coordinate = `@ivanov-gv/${packageName}`;
  return {
    spec: `${coordinate}@dev`,
    missingVersionMessage: `no dev version published for ${coordinate} (tag dev)`
  };
}

// imagetools reads the manifest without pulling the moving tag; an OCI index .Image is keyed by platform.
export function devImageInspectCommand(name) {
  const image = `${DEV_IMAGE_REPOSITORY}/${name}:dev`;
  return {image, args: ['buildx', 'imagetools', 'inspect', '--format', IMAGE_INSPECT_FORMAT, image]};
}

// npm view runs from a temporary directory so the repository .npmrc cannot override the token (issue #370).
export function devPackageViewCommand(packageName, directory, auth) {
  const target = devPackageTarget(packageName);
  const userConfig = path.join(directory, '.npmrc');
  return {
    args: [
      'view',
      target.spec,
      'version',
      '--registry',
      'https://npm.pkg.github.com',
      '--userconfig',
      userConfig
    ],
    options: {cwd: directory, encoding: 'utf8', stdio: 'pipe', env: auth.env}
  };
}

// ci-publish versions each dev package as 0.0.0-dev.<full 40-digit commit>; any other shape is not a dev artifact.
export function commitFromDevVersion(version) {
  const match = /^0\.0\.0-dev\.([0-9a-f]{40})$/.exec(String(version).trim());
  if (!match) throw new Error(`unexpected dev version: ${version}`);
  return match[1];
}

function revisionFromLabels(labels) {
  const commit = labels?.[DEV_IMAGE_LABEL];
  if (!/^[0-9a-f]{40}$/.test(String(commit))) throw new Error(`missing ${DEV_IMAGE_LABEL} label`);
  return commit;
}

// imagetools .Image is one image config, or a platform-keyed map for an OCI index.
export function commitFromImageInspect(text) {
  let image;
  try {
    image = JSON.parse(text);
  } catch (error) {
    throw new Error(`unreadable image inspect output: ${text}`, {cause: error});
  }
  const entry = image?.config ? image : image?.['linux/amd64'];
  if (!entry?.config) throw new Error('unexpected image inspect output: no single image or linux/amd64 platform');
  return revisionFromLabels(entry.config.Labels);
}

// Only a not-found answer means the dev package is absent. Any other npm failure (401, 403, a network error) must stop
// the run instead of looking like a missing artifact.
export function isPackageVersionMissing(failureText) {
  return /\bE404\b/.test(String(failureText));
}

// imagetools reports a missing :dev tag as MANIFEST_UNKNOWN, NAME_UNKNOWN or a 404; auth and network errors must not
// look like one.
export function isImageTagMissing(failureText) {
  const text = String(failureText);
  const authOrNetworkFailure =
    /\b(?:401|403)\b|unauthori[sz]ed|forbidden|denied|authentication|network|no such host|timed? out/i;
  if (authOrNetworkFailure.test(text)) return false;
  return /manifest[_ ]unknown|name[_ ]unknown|\b404\b|not found/i.test(text);
}

// npm expands NODE_AUTH_TOKEN when it reads the config, so the token stays in the environment and not on disk.
export function npmAuthForRegistry(token, environment) {
  return {userConfig: NPM_REGISTRY_USER_CONFIG, env: {...environment, NODE_AUTH_TOKEN: token}};
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

function devCommitForPackage(packageName) {
  const target = devPackageTarget(packageName);
  const auth = npmAuthForRegistry(requireEnv('GH_TOKEN'), process.env);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-package-check-'));
  const userConfig = path.join(directory, '.npmrc');
  fs.writeFileSync(userConfig, auth.userConfig, {mode: 0o600});
  const {args, options} = devPackageViewCommand(packageName, directory, auth);
  let version;
  try {
    // cwd is the temporary directory, outside the repository .npmrc (issue #370).
    version = execFileSync('npm', args, options);
  } catch (error) {
    const failureText = commandFailureText(error);
    if (isPackageVersionMissing(failureText)) throw new Error(target.missingVersionMessage, {cause: error});
    throw new Error(`could not check ${target.spec}: ${failureText}`, {cause: error});
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
  try {
    return commitFromDevVersion(version);
  } catch (error) {
    throw new Error(`unexpected version for ${target.spec}: ${version}`, {cause: error});
  }
}

function loginToGithubRegistry() {
  execFileSync(
    'docker',
    ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR || 'github-actions', '--password-stdin'],
    {input: requireEnv('GH_TOKEN'), env: process.env}
  );
}

function devCommitForImage(name) {
  const {image, args} = devImageInspectCommand(name);
  let inspectText;
  try {
    inspectText = execFileSync('docker', args, {encoding: 'utf8', stdio: 'pipe', env: process.env});
  } catch (error) {
    const failureText = commandFailureText(error);
    if (isImageTagMissing(failureText))
      throw new Error(`${image}: no dev tag published; ci-publish on main publishes it`, {cause: error});
    throw new Error(`could not inspect ${image}: ${failureText}`, {cause: error});
  }
  try {
    return commitFromImageInspect(inspectText);
  } catch (error) {
    throw new Error(`${image}: no valid ${DEV_IMAGE_LABEL} label; ci-publish on main publishes it`, {cause: error});
  }
}

function devCommitForWorkflow(workflow) {
  const packageName = PACKAGE_BY_WORKFLOW[workflow];
  if (packageName) return devCommitForPackage(packageName);
  const imageName = IMAGE_BY_WORKFLOW[workflow];
  if (!imageName) throw new Error(`No dev artifact is defined for ${workflow}`);
  return devCommitForImage(imageName);
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
    const commit = devCommitForWorkflow(workflow);
    report(`${workflow}: dev tag resolves to ${commit}`);
    const imageName = IMAGE_BY_WORKFLOW[workflow];
    if (imageName) prepareTestImage(imageName, commit);
    const marker = testMarkerFor(workflow, {playwrightVersion, runId});
    const minimumId = dispatch(workflow, branch, {commit, marker});
    pending.push({workflow, headCommit, marker, minimumId});
    report(`${workflow}: dispatched test_run=true with ${marker}.`);
  }

  waitForDispatchedRuns(pending);
  report(`CD test-run check passed for ${workflows.length} changed workflow(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
