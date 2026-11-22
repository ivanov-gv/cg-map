import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import parseYaml from 'markdownlint-cli2/parsers/yaml';
import {EDITOR_BROWSER_AREAS, FOLDERS, browserMatrix} from '../tools/ci-plan.mjs';
import {repoRoot} from '../agents/lib.mjs';

const execFileAsync = promisify(execFile);

const workflowDir = path.join(repoRoot, '.github/workflows');
const newWorkflowFiles = fs.readdirSync(workflowDir).filter(file => /^(ci|cd)-.*\.yml$/.test(file));
const load = file => parseYaml(fs.readFileSync(path.join(workflowDir, file), 'utf8'));

// Jobs that stand alone, each with its reason in the workflow's comments.
const NO_TWIN = {
  'ci-pr-checks.yml': ['approval', 'switch', 'gate', 'job-times', ...FOLDERS],
  'ci-nightly.yml': ['run'],
  'ci-workflows.yml': ['test-run-evidence'],
  'cd-map-core.yml': ['switch'],
  'cd-map-data.yml': ['switch'],
  'cd-browser-image.yml': ['switch'],
  'cd-dev-pages.yml': ['switch', 'deploy'],
  'ci-publish.yml': ['switch', 'select']
};

// Each twin is chosen by the mode directly, or by depending on a job that was.
function assertSelectedByMode(jobs, job) {
  const twin = `${job}-test-run`;
  const dependsOnTwin =
    [jobs[job].needs].flat().some(need => need && jobs[`${need}-test-run`]) &&
    [jobs[twin].needs].flat().every(need => need?.endsWith('-test-run'));
  if (dependsOnTwin) return;
  const conditions = [jobs[job].if, jobs[twin].if];
  const inputChoice = /inputs\.test_run != true/.test(conditions[0]) && /inputs\.test_run == true/.test(conditions[1]);
  const switchChoice = /test_run != 'true'/.test(conditions[0]) && /test_run == 'true'/.test(conditions[1]);
  assert.ok(
    inputChoice || switchChoice,
    `${job} and its twin need opposite test_run conditions: ${conditions.join(' | ')}`
  );
}

for (const file of newWorkflowFiles) {
  test(`${file}: every job has a test-run twin with the same steps`, () => {
    const {jobs} = load(file);
    const standalone = NO_TWIN[file] ?? [];
    const production = Object.keys(jobs).filter(job => !job.endsWith('-test-run') && !standalone.includes(job));
    // ci-nightly only calls ci-pr-checks; it has no production jobs of its own to twin.
    if (file === 'ci-nightly.yml') {
      assert.equal(production.length, 0, 'ci-nightly should have no production jobs');
      return;
    }
    assert.ok(production.length > 0, `${file} should have at least one production job`);
    for (const job of production) {
      const twin = jobs[`${job}-test-run`];
      assert.ok(twin, `${job} needs a ${job}-test-run twin`);
      assert.equal(twin.environment, 'test-run', `${job}-test-run must use the test-run environment`);
      assert.notEqual(jobs[job].environment, 'test-run', `${job} must not use the test-run environment`);
      assertSelectedByMode(jobs, job);
      if (job === 'deploy') continue;
      assert.deepEqual(twin.steps, jobs[job].steps, `${job} and its twin must share steps`);
      if (jobs[job].env)
        assert.deepEqual(
          Object.keys(twin.env),
          Object.keys(jobs[job].env),
          `${job} and its twin must define the same env`
        );
    }
  });

  test(`${file}: steps never read the test-run mode or secrets directly`, () => {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      const stepsText = JSON.stringify(job.steps ?? []);
      assert.doesNotMatch(
        stepsText,
        /\$\{\{\s*(secrets|vars)\./,
        `${name} steps must read secrets and vars through env`
      );
      // The switch reads the input, and the evidence check searches for runs by name.
      const namesTheMode = ['switch', 'test-run-evidence'].includes(name);
      if (!namesTheMode) assert.doesNotMatch(stepsText, /test_run/, `${name} steps must not know the mode`);
    }
  });

  test(`${file}: manual runs default to test-run mode`, () => {
    const {test_run: testRun} = load(file).on.workflow_dispatch.inputs;
    assert.equal(testRun.type, 'boolean');
    assert.equal(testRun.default, true);
  });

  test(`${file}: has a make target under test-all-workflows`, () => {
    const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
    const target = `test-${file.replace('.yml', '')}`;
    assert.match(makefile.match(/^test-all-workflows:(.*)$/m)[1], new RegExp(`(^| )${target}( |$)`));
  });
}

test('CI workflows never touch production', () => {
  for (const file of newWorkflowFiles.filter(name => name.startsWith('ci-'))) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      const environment = job.environment;
      const allowedEnvironments = ['dev', 'test-run', 'ci-approval'];
      if (environment) assert.ok(allowedEnvironments.includes(environment), `${file} ${name} uses ${environment}`);
      for (const permission of ['pages', 'id-token']) {
        assert.equal(job.permissions?.[permission], undefined, `${file} ${name} must not request ${permission}`);
      }
    }
    assert.equal(load(file).permissions.contents, 'read', `${file} must default to read-only`);
  }
});

const CD_TAGS = {
  'cd-map-core.yml': 'map-core/v',
  'cd-map-data.yml': 'map-data/v',
  'cd-browser-image.yml': 'browser-image/v'
};

for (const [file, tagPrefix] of Object.entries(CD_TAGS))
  test(`${file}: CD checks out no application source, and only a release or a manual run can start it`, () => {
  const {jobs, permissions, on} = load(file);
  assert.deepEqual(permissions, {});
  assert.deepEqual(Object.keys(on).sort(), ['release', 'workflow_dispatch']);
  assert.deepEqual(on.release.types, ['published']);
  const checkouts = Object.values(jobs)
    .flatMap(job => job.steps ?? [])
    .filter(step => step.uses?.startsWith('actions/checkout'));
  assert.ok(checkouts.length > 0);
  for (const checkout of checkouts) {
    assert.equal(checkout.with['sparse-checkout'], '.github/actions');
    assert.equal(checkout.with['sparse-checkout-cone-mode'], false, 'cone mode would also check out root files');
  }
  assert.ok(jobs.switch.if.includes(`startsWith(github.event.release.tag_name, '${tagPrefix}')`));
  assert.equal(jobs.publish.environment, 'package-release');
  assert.equal(jobs['publish-test-run'].environment, 'test-run');
  assert.equal(jobs['publish-test-run'].permissions.packages, 'read', 'a test run must be unable to publish');
});

test('only cd-dev-pages deploy uses actions/deploy-pages, and no ci-* workflow does', () => {
  for (const file of newWorkflowFiles) {
    const {jobs} = load(file);
    for (const [name, job] of Object.entries(jobs)) {
      const stepsText = JSON.stringify(job.steps ?? []);
      if (file.startsWith('ci-')) {
        assert.doesNotMatch(
          stepsText,
          /actions\/deploy-pages/,
          `${file} ${name} must not use actions/deploy-pages`
        );
      }
    }
  }
  // cd-dev-pages deploy is the only job that uses deploy-pages.
  const {jobs: cdJobs} = load('cd-dev-pages.yml');
  const cdStepsText = JSON.stringify(cdJobs.deploy.steps);
  assert.match(cdStepsText, /actions\/deploy-pages/, 'cd-dev-pages deploy must use actions/deploy-pages');
  for (const [name, job] of Object.entries(cdJobs)) {
    if (name === 'deploy') continue;
    const stepsText = JSON.stringify(job.steps ?? []);
    assert.doesNotMatch(stepsText, /actions\/deploy-pages/, `cd-dev-pages ${name} must not use actions/deploy-pages`);
  }
});

// GitHub Packages requires a token even for public packages, so npm ci needs the packages permission.
test('jobs that use setup-web or install-dependencies have packages permission', () => {
  for (const file of newWorkflowFiles) {
    const {jobs, permissions: workflowPermissions} = load(file);
    for (const [name, job] of Object.entries(jobs)) {
      // Only check uses: fields, not run: text (which may mention actions in grep patterns).
      const usesPackageActions = (job.steps ?? []).some(
        step => step.uses?.includes('setup-web') || step.uses?.includes('install-dependencies')
      );
      if (!usesPackageActions) continue;
      const effectivePermissions = job.permissions ?? workflowPermissions ?? {};
      const hasPackagesRead = ['read', 'write'].includes(effectivePermissions.packages);
      assert.ok(
        hasPackagesRead,
        `${file} ${name} uses setup-web or install-dependencies but lacks packages: read`
      );
    }
  }
});

test('ci-publish pages job builds every app, because it replaces the whole site', () => {
  const stepsText = JSON.stringify(load('ci-publish.yml').jobs.pages.steps);
  assert.match(stepsText, /for app in web editor core-demo/);
  // No longer pulls :main images — builds from source instead.
  assert.doesNotMatch(stepsText, /:main/);
  // Writes version.json with commit, run_id, and built_at.
  assert.match(stepsText, /version\.json/);
  assert.match(stepsText, /GITHUB_RUN_ID/);
  // Builds from the source subdirectory (second checkout).
  assert.match(stepsText, /source\/apps/);
  const appDirectories = fs.readdirSync(path.join(repoRoot, 'apps'));
  assert.deepEqual(appDirectories.toSorted(), ['core-demo', 'editor', 'web']);
});

test('ci-publish pages job publishes dev-pages image tagged by commit', () => {
  const {jobs} = load('ci-publish.yml');
  const publishStep = jobs.pages.steps.find(s => s.uses?.includes('publish-image'));
  assert.ok(publishStep, 'pages must use publish-image action');
  assert.equal(publishStep.with.name, 'dev-pages', 'must publish dev-pages image');
  assert.equal(publishStep.with.repository, '${{ env.IMAGE_REPOSITORY }}', 'must use IMAGE_REPOSITORY');
  assert.equal(publishStep.with.commit, '${{ env.COMMIT }}', 'must pass commit SHA');
  // Dockerfile comes from the workflow checkout (first checkout), not from source/.
  // Build context is the site/ directory, because the root .dockerignore excludes it otherwise.
  assert.equal(publishStep.with.dockerfile, 'platform/pages/Dockerfile', 'must use workflow checkout Dockerfile');
  assert.equal(publishStep.with.context, 'site', 'must use site/ as build context');
});

test('cd-dev-pages find job pulls image by commit SHA', () => {
  const stepsText = JSON.stringify(load('cd-dev-pages.yml').jobs.find.steps);
  assert.match(stepsText, /docker pull/, 'must pull the image');
  assert.match(stepsText, /dev-pages/, 'must pull dev-pages image');
  assert.match(stepsText, /COMMIT_SHA/, 'must use commit SHA as tag');
  assert.match(stepsText, /docker create/, 'must create container to extract');
  assert.match(stepsText, /docker cp/, 'must copy files from container');
});

test('jobs below the optional approval survive it being skipped', () => {
  const {jobs} = load('ci-pr-checks.yml');
  const statusFunction = /\b(always|cancelled|failure|success)\(\)/;
  for (const [name, job] of Object.entries(jobs)) {
    // A skipped ancestor skips any job whose condition has no status function, on every run but a pull request.
    if (name !== 'approval')
      assert.match(String(job.if), statusFunction, `${name} would be skipped outside pull requests`);
  }
});

// Permission levels for comparing grants against requests; write covers read.
const PERMISSION_LEVELS = {none: 0, read: 1, write: 2};

// Check that a called workflow's permissions are covered by what the caller grants.
// GitHub forbids cycles in reusable workflow calls, so no visited set is needed.
function checkCalledWorkflow(callerFile, callerJobName, callerJob, callerDefaults) {
  const calledFile = callerJob.uses.replace('./.github/workflows/', '');
  const granted = callerJob.permissions ?? callerDefaults;
  const called = load(calledFile);
  const requests = [called.permissions, ...Object.values(called.jobs).map(calledJob => calledJob.permissions)];
  for (const request of requests.filter(Boolean)) {
    for (const [permission, level] of Object.entries(request)) {
      const allows = PERMISSION_LEVELS[granted?.[permission] ?? 'none'] >= PERMISSION_LEVELS[level];
      assert.ok(
        allows,
        `${callerFile} ${callerJobName} grants ${granted?.[permission] ?? 'none'} for ${permission}, but ${calledFile} needs ${level}`
      );
    }
  }
  for (const [nestedJobName, nestedJob] of Object.entries(called.jobs)) {
    if (nestedJob.uses?.startsWith('./.github/workflows/')) {
      checkCalledWorkflow(calledFile, nestedJobName, nestedJob, called.permissions);
    }
  }
}

test('a called workflow asks for no more than its caller grants, or the whole run fails to start', () => {
  for (const file of newWorkflowFiles) {
    const {jobs, permissions: defaults} = load(file);
    for (const [name, job] of Object.entries(jobs)) {
      if (job.uses?.startsWith('./.github/workflows/')) {
        checkCalledWorkflow(file, name, job, defaults);
      }
    }
  }
});

test('only the publish workflow writes packages, and only from main unless it is a test run', () => {
  const {jobs} = load('ci-publish.yml');
  const writers = Object.entries(jobs).filter(([, job]) => job.permissions?.packages === 'write');
  assert.deepEqual(
    writers.map(([name]) => name).toSorted(),
    ['browser-image', 'data-package', 'image', 'package', 'pages', 'pages-cleanup']
  );
  for (const [name, writer] of writers) {
    assert.match(writer.if, /github\.ref == 'refs\/heads\/main'/, `${name} could publish from a branch`);
    const twin = jobs[`${name}-test-run`];
    if (twin) {
      assert.equal(twin.permissions.packages, 'read', `a test run of ${name} must be unable to publish`);
    }
  }
  const others = newWorkflowFiles.filter(file => file.startsWith('ci-') && file !== 'ci-publish.yml');
  for (const file of others) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      assert.notEqual(job.permissions?.packages, 'write', `${file} ${name} must leave publishing to ci-publish`);
    }
  }
});

// The aim is 5 minutes, which the job-times job in ci-pr-checks warns about. 7 is the limit: see ADR 0006.
const JOB_TIME_LIMIT_MINUTES = 7;

test('every job that runs has a time limit of at most 7 minutes', () => {
  for (const file of newWorkflowFiles) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      if (job.uses) continue;
      assert.ok(job['timeout-minutes'], `${file} ${name} needs timeout-minutes`);
      assert.ok(job['timeout-minutes'] <= JOB_TIME_LIMIT_MINUTES, `${file} ${name} may run over the limit`);
    }
  }
});

test('job times are checked after everything else, and can only warn', () => {
  const job = load('ci-pr-checks.yml').jobs['job-times'];
  assert.equal(job.if, 'always()');
  assert.deepEqual(new Set(job.needs), new Set(['gate']));
  assert.deepEqual(job.permissions, {actions: 'read'});
  assert.doesNotMatch(job.steps[0].run, /exit 1|::error::/);
});

test('gate approval job name env matches the approval job name', () => {
  const {jobs} = load('ci-pr-checks.yml');
  const approvalJobName = jobs.approval.name;
  const gateEnv = jobs.gate.env;
  assert.equal(gateEnv.APPROVAL_JOB_NAME, approvalJobName, 'gate APPROVAL_JOB_NAME must match approval job name');
});

test('the editor browser jobs cover every spec in both projects', () => {
  const matrix = browserMatrix(Object.keys(EDITOR_BROWSER_AREAS), EDITOR_BROWSER_AREAS);
  const specFiles = fs.readdirSync(path.join(repoRoot, 'apps/editor/tests/e2e')).filter(file => file.endsWith('.spec.mjs'));
  const runs = (spec, project, entry) =>
    entry.specs.includes(spec) && (entry.specs.includes(`--project=${project}`) || !entry.specs.includes('--project='));
  for (const spec of specFiles) {
    for (const project of ['root-desktop', 'pages-mobile']) {
      const entries = matrix.include.filter(entry => runs(spec, project, entry));
      assert.ok(entries.length > 0, `${spec} does not run on ${project}`);
      const shards = entries.map(entry => entry.specs.match(/--shard=(\d+)\/(\d+)/));
      if (shards.every(shard => !shard)) continue;
      assert.ok(shards.every(Boolean), `${spec} on ${project} mixes a whole run with shards`);
      const everyShard = Array.from({length: Number(shards[0][2])}, (_, index) => String(index + 1));
      assert.deepEqual(shards.map(shard => shard[1]).toSorted(), everyShard, `${spec} on ${project} misses a shard`);
    }
  }
});

test('CD refuses a commit that is not on main', () => {
  for (const file of Object.keys(CD_TAGS)) {
    const step = load(file).jobs.switch.steps.find(({id}) => id === 'release');
    assert.equal(step.uses, './.github/actions/resolve-release', `${file} could release any commit`);
  }
  const action = fs.readFileSync(path.join(repoRoot, '.github/actions/resolve-release/action.yml'), 'utf8');
  assert.match(action, /compare\/main\.\.\./);
});

test('cd-dev-pages triggers on workflow_run (ci-publish) with branches and workflow_dispatch with commit input', () => {
  const {on} = load('cd-dev-pages.yml');
  assert.ok(on.workflow_run, 'cd-dev-pages must trigger on workflow_run');
  assert.deepEqual(on.workflow_run.workflows, ['ci-publish']);
  assert.deepEqual(on.workflow_run.types, ['completed']);
  assert.deepEqual(on.workflow_run.branches, ['main']);
  assert.ok(on.workflow_dispatch, 'cd-dev-pages must accept workflow_dispatch');
  assert.equal(on.workflow_dispatch.inputs.commit.type, 'string');
  assert.equal(on.workflow_dispatch.inputs.test_run.default, true);
});

test('cd-dev-pages deploy is the only CD job with Pages permissions', () => {
  const {jobs} = load('cd-dev-pages.yml');
  assert.deepEqual(jobs.deploy.permissions, {pages: 'write', 'id-token': 'write'});
  // Deploy runs when find succeeds — no is_newest check; every commit deploys its own version.
  // Requires find to have succeeded so a skipped find (test-run) does not deploy.
  assert.match(jobs.deploy.if, /needs\.find\.result == 'success'/);
  assert.doesNotMatch(jobs.deploy.if, /is_newest/, 'must not check is_newest');
  assert.deepEqual(jobs.deploy.concurrency, {group: 'dev-pages', 'cancel-in-progress': false});
  // find and find-test-run must not have pages permissions
  for (const job of ['find', 'find-test-run']) {
    assert.equal(jobs[job]?.permissions?.pages, undefined, `${job} must not request pages`);
  }
});


test('cd-dev-pages has no workflow_call trigger', () => {
  assert.equal(load('cd-dev-pages.yml').on.workflow_call, undefined, 'cd-dev-pages must not use workflow_call');
});

test('cd-dev-pages find maps IMAGE_REPOSITORY from vars', () => {
  const {jobs} = load('cd-dev-pages.yml');
  // Production find maps from vars
  assert.equal(jobs.find.env.IMAGE_REPOSITORY, '${{ vars.IMAGE_REPOSITORY }}');
  // Test-run twin maps from vars
  assert.equal(jobs['find-test-run'].env.IMAGE_REPOSITORY, '${{ vars.IMAGE_REPOSITORY }}');
});

test('cd-dev-pages find uses environment dev', () => {
  const {jobs} = load('cd-dev-pages.yml');
  assert.equal(jobs.find.environment, 'dev');
});

test('ci-publish pages job validates commit as 40-character SHA', () => {
  const stepsText = JSON.stringify(load('ci-publish.yml').jobs.pages.steps);
  assert.match(stepsText, /\[0-9a-f\]\{40\}/, 'must validate commit as 40-char hex SHA');
});

test('ci-publish has commit input for workflow_dispatch', () => {
  const {on} = load('ci-publish.yml');
  assert.ok(on.workflow_dispatch.inputs.commit, 'ci-publish must have commit input');
  assert.equal(on.workflow_dispatch.inputs.commit.type, 'string');
  assert.equal(on.workflow_dispatch.inputs.commit.required, false);
});

test('cd-dev-pages find validates commit as 40-character SHA', () => {
  const stepsText = JSON.stringify(load('cd-dev-pages.yml').jobs.find.steps);
  assert.match(stepsText, /\[0-9a-f\]\{40\}/, 'must validate commit as 40-char hex SHA');
});

test('cd-dev-pages find errors when image is not found', () => {
  const stepsText = JSON.stringify(load('cd-dev-pages.yml').jobs.find.steps);
  assert.match(stepsText, /::error::.*not found/, 'must emit ::error:: when image is not found');
});

// Evaluate the find job's if: expression against event/conclusion/branch combinations.
// On workflow_run, find only runs when ALL three hold: event==push, head_branch==main, conclusion==success.
// On workflow_dispatch, find always runs (manual deploy bypasses CI check).
// A failed, cancelled, or non-main CI run must skip CD cleanly — no red run.
function evaluateFindIf(expression, context) {
  let expr = expression
    .replace(/\$\{\{\s*/g, '')
    .replace(/\s*\}\}/g, '')
    .trim();
  for (const [key, value] of Object.entries(context)) {
    expr = expr.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), JSON.stringify(value));
  }
  expr = expr.replace(/!cancelled\(\)/g, '(!context_cancelled)');
  return Function('context_cancelled', 'return ' + expr + ';')();
}

test('cd-dev-pages find if: only push+main+success runs, everything else skips', () => {
  const findIf = load('cd-dev-pages.yml').jobs.find.if;

  const cases = [
    // Core case: push on main with success → runs
    {event: 'workflow_run', ciEvent: 'push', headBranch: 'main', conclusion: 'success', testRun: 'false', cancelled: false, wantRun: true, label: 'push+main+success'},
    // workflow_dispatch-triggered CI run (event workflow_dispatch) → skips
    {event: 'workflow_run', ciEvent: 'workflow_dispatch', headBranch: 'main', conclusion: 'success', testRun: 'false', cancelled: false, wantRun: false, label: 'workflow_dispatch CI run'},
    // Failure → skips
    {event: 'workflow_run', ciEvent: 'push', headBranch: 'main', conclusion: 'failure', testRun: 'false', cancelled: false, wantRun: false, label: 'push+main+failure'},
    // Cancelled → skips
    {event: 'workflow_run', ciEvent: 'push', headBranch: 'main', conclusion: 'cancelled', testRun: 'false', cancelled: false, wantRun: false, label: 'push+main+cancelled'},
    // Another branch → skips
    {event: 'workflow_run', ciEvent: 'push', headBranch: 'feature-branch', conclusion: 'success', testRun: 'false', cancelled: false, wantRun: false, label: 'push+feature+success'},
    // CD workflow_dispatch (rollback/test run) → runs
    {event: 'workflow_dispatch', ciEvent: '', headBranch: '', conclusion: '', testRun: 'false', cancelled: false, wantRun: true, label: 'CD workflow_dispatch'},
    // CD workflow_dispatch test_run → skips (test_run gate)
    {event: 'workflow_dispatch', ciEvent: '', headBranch: '', conclusion: '', testRun: 'true', cancelled: false, wantRun: false, label: 'CD workflow_dispatch test_run'},
  ];

  for (const tc of cases) {
    const got = evaluateFindIf(findIf, {
      'github.event_name': tc.event,
      'github.event.workflow_run.event': tc.ciEvent,
      'github.event.workflow_run.head_branch': tc.headBranch,
      "github.event.workflow_run.conclusion": tc.conclusion,
      "needs.switch.outputs.test_run": tc.testRun,
    });
    assert.equal(
      got === true,
      tc.wantRun,
      `${tc.label}: want run=${tc.wantRun}, got ${got} (if: ${findIf})`
    );
  }
});


// Evaluate the deploy job's if: expression against event/is_newest/find-result combinations.
// The deploy must only run on workflow_run when is_newest (so older runs don't overwrite newer sites),
// and must always run on workflow_dispatch when find succeeds (for rollback).
// It must not run when find is skipped (test-run) or fails.
function evaluateDeployIf(expressionText, context) {
  // Replace GitHub Actions expression syntax with JavaScript equivalents.
  let expression = expressionText
    .replace(/\$\{\{\s*/g, '')
    .replace(/\s*\}\}/g, '')
    .trim();
  for (const [key, value] of Object.entries(context)) {
    expression = expression.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), JSON.stringify(value));
  }
  // Handle !cancelled() -> context.cancelled
  expression = expression.replace(/!cancelled\(\)/g, '(!context_cancelled)');
  return Function('context_cancelled', 'return ' + expression + ';')();
}

test('cd-dev-pages deploy gating: find-success deploys, find-fail and find-skipped skip', () => {
  const deployIf = load('cd-dev-pages.yml').jobs.deploy.if;

  const cases = [
    {event: 'workflow_run', findResult: 'success', cancelled: false, wantDeploy: true, label: 'workflow_run, find success'},
    {event: 'workflow_dispatch', findResult: 'success', cancelled: false, wantDeploy: true, label: 'dispatch, find success'},
    {event: 'workflow_dispatch', findResult: 'skipped', cancelled: false, wantDeploy: false, label: 'dispatch test run (find skipped)'},
    {event: 'workflow_dispatch', findResult: 'failure', cancelled: false, wantDeploy: false, label: 'find failed'},
  ];

  for (const testCase of cases) {
    const got = evaluateDeployIf(deployIf, {
      'github.event_name': testCase.event,
      "needs.find.result": testCase.findResult,
    });
    const deployed = got === true;
    assert.equal(
      deployed,
      testCase.wantDeploy,
      `${testCase.label}: want deploy=${testCase.wantDeploy}, got ${deployed} (if: ${deployIf})`
    );
  }
});

test('a pull request runs nothing until it is approved', () => {
  const {jobs} = load('ci-pr-checks.yml');
  assert.equal(jobs.approval.environment, 'ci-approval');
  assert.match(jobs.approval.if, /pull_request/);
  assert.deepEqual([jobs.switch.needs].flat(), ['approval']);
  const reachesApproval = name => {
    if (name === 'approval') return true;
    return [jobs[name].needs ?? []].flat().some(reachesApproval);
  };
  for (const name of Object.keys(jobs)) assert.ok(reachesApproval(name), `${name} would run before approval`);
});

// ci-workflows test-run-evidence must require a qualifying test run when workflow files change.
// Run the real step script with a fake `gh` stub (platform/tests/fixtures/fake-gh.sh).
const ciWorkflowsScript = load('ci-workflows.yml').jobs['test-run-evidence'].steps[0].run;
const fakeGhPath = path.join(repoRoot, 'platform/tests/fixtures/fake-gh.sh');

// Set up a temporary directory with the fake gh stub and run the test-run-evidence script.
// Returns {code, stdout, stderr} from executing the script.
async function runEvidenceTest(prFiles, stubFiles) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ci-workflows-test-'));
  const stubDirectory = path.join(temporaryDirectory, 'stub');
  await fs.promises.mkdir(stubDirectory);
  await fs.promises.writeFile(path.join(stubDirectory, 'pr-files'), prFiles.join('\n'));
  for (const [name, content] of Object.entries(stubFiles)) {
    await fs.promises.writeFile(path.join(stubDirectory, name), content);
  }
  const ghPath = path.join(temporaryDirectory, 'gh');
  await fs.promises.copyFile(fakeGhPath, ghPath);
  await fs.promises.chmod(ghPath, 0o755);

  const env = {
    PATH: temporaryDirectory + ':' + process.env.PATH,
    GH_TOKEN: 'fake-token',
    GH_REPO: 'owner/repo',
    HEAD_SHA: 'abc123',
    PR_NUMBER: '42',
    BRANCH: 'feature-branch',
    GITHUB_STEP_SUMMARY: path.join(temporaryDirectory, 'summary'),
    FAKE_GH_DIR: stubDirectory,
  };

  try {
    const result = await execFileAsync('bash', ['-c', ciWorkflowsScript], {env, cwd: temporaryDirectory});
    return {code: 0, stdout: result.stdout, stderr: result.stderr};
  } catch (err) {
    return {code: err.code, stdout: err.stdout, stderr: err.stderr};
  } finally {
    await fs.promises.rm(temporaryDirectory, {recursive: true, force: true});
  }
}

test('ci-workflows: ci-publish.yml changed, no qualifying run must fail', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'runs-ci-publish.yml': '[{"displayTitle":"other run"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 1, 'ci-publish.yml changed without qualifying run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run ci-publish\.yml --ref.*-f test_run=true/,
    'error must name the ci-publish dispatch command'
  );
});

test('ci-workflows: ci-publish.yml changed, with qualifying run must pass', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'runs-ci-publish.yml': '[{"displayTitle":"ci-publish test_run=true"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[]',
    }
  );
  assert.equal(result.code, 0, 'ci-publish.yml changed with qualifying run must exit 0');
});

test('ci-workflows: cd-map-data.yml changed, no qualifying run must fail', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/cd-map-data.yml'],
    {
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-map-data.yml': '[{"displayTitle":"other run"}]',
    }
  );
  assert.equal(result.code, 1, 'cd-map-data.yml changed without qualifying run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run cd-map-data\.yml --ref.*-f test_run=true/,
    'error must name the cd-map-data dispatch command'
  );
});

test('ci-workflows: cd-map-data.yml changed, with qualifying run must pass', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/cd-map-data.yml'],
    {
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-map-data.yml': '[{"displayTitle":"cd-map-data test_run=true"}]',
    }
  );
  assert.equal(result.code, 0, 'cd-map-data.yml changed with qualifying run must exit 0');
});

test('ci-workflows: setup-web changed, no ci-publish run must fail', async () => {
  const result = await runEvidenceTest(
    ['.github/actions/setup-web/action.yml'],
    {
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[{"displayTitle":"cd-map-core test_run=true"}]',
      'runs-cd-map-data.yml': '[{"displayTitle":"cd-map-data test_run=true"}]',
    }
  );
  assert.equal(result.code, 1, 'setup-web changed without ci-publish run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run ci-publish\.yml --ref.*-f test_run=true/,
    'error must name the ci-publish dispatch command'
  );
});

// setup-web is checked by the ci-publish test-run-evidence check because ci-publish builds the site.

test('ci-workflows: non-publish workflow changed does not require ci-publish run', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-apps-web.yml'],
    {
      'runs-ci-publish.yml': '[{"displayTitle":"other run"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 0, 'ci-apps-web.yml changed does not require ci-publish run');
});

test('ci-workflows: ci-publish.yml not on main is exempt from test-run requirement', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'contents-ci-publish.yml': 'HTTP 404 NOT FOUND',
      'runs-ci-publish.yml': '[]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[]',
    }
  );
  assert.equal(result.code, 0, 'ci-publish.yml not on main is exempt');
});

test('ci-workflows: a workflow on main without workflow_dispatch is exempt', async () => {
  // Simulate ci-publish.yml on main with only workflow_call (no workflow_dispatch).
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'contents-ci-publish.yml': 'name: ci-publish\non:\n  workflow_call:\n    inputs:\n      test_run:\n        type: boolean\n',
      'runs-ci-publish.yml': '[]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[]',
    }
  );
  assert.equal(result.code, 0, 'workflow without workflow_dispatch on main is exempt');
  assert.match(result.stdout, /no workflow_dispatch trigger/, 'must explain the exemption');
});

test('ci-workflows: a workflow on main with workflow_dispatch but no run still fails', async () => {
  // Simulate ci-publish.yml on main with workflow_dispatch, but no qualifying run.
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'contents-ci-publish.yml': 'name: ci-publish\non:\n  workflow_call:\n    inputs:\n      test_run:\n        type: boolean\n  workflow_dispatch:\n    inputs:\n      test_run:\n        type: boolean\n',
      'runs-ci-publish.yml': '[{"displayTitle":"other run"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 1, 'workflow with workflow_dispatch but no qualifying run must fail');
  assert.match(
    result.stdout,
    /gh workflow run ci-publish\.yml --ref.*-f test_run=true/,
    'error must name the ci-publish dispatch command'
  );
});

test('ci-workflows: an API failure on the contents lookup fails the check', async () => {
  // Simulate an HTTP 500 on the metadata lookup (the single --jq .content call).
  // The check must fail, not exempt the workflow.
  const result = await runEvidenceTest(
    ['.github/workflows/ci-publish.yml'],
    {
      'contents-ci-publish.yml': 'error',
      'runs-ci-publish.yml': '[]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 1, 'API failure on contents lookup must fail the check, not exempt');
  assert.match(
    result.stderr,
    /Could not look up ci-publish\.yml/,
    'must report the API failure on stderr'
  );
});

// Every workflow that has_qualifying_run asks for must define a run-name
// whose workflow_dispatch branch formats test_run={0} from inputs.test_run,
// so a real dispatch title contains the search string the evidence check looks for.
test('every workflow checked by has_qualifying_run defines a run-name with test_run', () => {
  // Parse the ci-workflows script for all has_qualifying_run calls.
  const calls = ciWorkflowsScript.matchAll(/has_qualifying_run\s+(\S+)\s+'([^']+)'/g);
  const workflowFiles = [...calls].map(([, file]) => file);
  assert.ok(workflowFiles.length > 0, 'has_qualifying_run must be called at least once');
  for (const file of workflowFiles) {
    const workflow = load(file);
    assert.ok(workflow['run-name'], `${file} must define run-name for has_qualifying_run to match`);
    const runName = String(workflow['run-name']);
    assert.ok(
      runName.includes('workflow_dispatch'),
      `${file} run-name must branch on workflow_dispatch`
    );
    assert.ok(
      runName.includes('test_run='),
      `${file} run-name must format test_run= for dispatch runs`
    );
    assert.ok(
      runName.includes('inputs.test_run'),
      `${file} run-name must include inputs.test_run value`
    );
  }
});


test('ci-publish has a pages job that writes packages only from main', () => {
  const {jobs} = load('ci-publish.yml');
  assert.ok(jobs.pages, 'ci-publish must contain a pages job');
  assert.equal(jobs.pages.permissions.packages, 'write', 'pages must write packages');
  assert.match(jobs.pages.if, /github\.ref == 'refs\/heads\/main'/, 'pages could publish from a branch');
  assert.equal(jobs['pages-test-run'].permissions.packages, 'read', 'a test run of pages must be unable to publish');
});

test('ci-pr-checks has no push trigger, so only PRs and the nightly run check', () => {
  const {on} = load('ci-pr-checks.yml');
  assert.equal(on.push, undefined, 'ci-pr-checks must not trigger on push');
  assert.equal(on.schedule, undefined, 'ci-pr-checks must not have a schedule trigger');
});

test('ci-nightly calls ci-pr-checks with run_all and phone_tests set to all', () => {
  const {jobs} = load('ci-nightly.yml');
  const runJob = jobs.run;
  assert.equal(runJob.uses, './.github/workflows/ci-pr-checks.yml', 'ci-nightly must call ci-pr-checks');
  assert.equal(runJob.with.run_all, true, 'ci-nightly must pass run_all: true');
  assert.equal(runJob.with.phone_tests, 'all', 'ci-nightly must pass phone_tests: all');
});

test('ci-publish triggers on push to main and workflow dispatch', () => {
  const {on} = load('ci-publish.yml');
  assert.deepEqual(Object.keys(on).sort(), ['push', 'workflow_dispatch'], 'ci-publish trigger set');
  assert.deepEqual(on.push.branches, ['main'], 'ci-publish must only trigger on main');
});

test('ci-publish publishes a map-data dev package when the plan selects data', () => {
  const {jobs} = load('ci-publish.yml');
  assert.equal(jobs.plan.outputs.data, '${{ steps.plan.outputs.data }}');
  assert.equal(jobs['plan-test-run'].outputs.data, '${{ steps.plan.outputs.data }}');
  const publish = jobs['data-package'];
  assert.match(publish.if, /needs\.plan\.outputs\.data == 'true' \|\| needs\.plan-test-run\.outputs\.data == 'true'/);
  assert.match(publish.if, /github\.ref == 'refs\/heads\/main'/, 'the data package could be published from a branch');
  const packageStep = publish.steps.find(step => step.uses?.includes('publish-dev-package'));
  assert.ok(packageStep, 'the data package job must use publish-dev-package');
  assert.equal(packageStep.with.directory, 'source/data', 'the requested source must be published');
  assert.equal(publish.env.PACKAGE_COMMIT, '${{ inputs.commit || github.sha }}', 'dispatch must select a commit');
  const checkouts = publish.steps.filter(step => step.uses === 'actions/checkout@v7');
  assert.equal(checkouts.length, 2, 'the action revision and source commit need separate checkouts');
  assert.equal(checkouts[0].with.ref, undefined, 'local actions must come from the workflow revision');
  assert.equal(checkouts[1].with.ref, '${{ env.PACKAGE_COMMIT }}', 'the data job must check out that commit');
  assert.equal(checkouts[1].with.path, 'source');
  assert.equal(packageStep.with.commit, '${{ env.PACKAGE_COMMIT }}', 'the package identity must use that commit');
  assert.match(publish.steps.map(step => step.run ?? '').join('\n'), /\[0-9a-f\]\{40\}/, 'commit must be a full SHA');
  assert.deepEqual(jobs['data-package-test-run'].steps, publish.steps);
  assert.equal(jobs['data-package-test-run'].environment, 'test-run');
});

test('publish-dev-package versions a requested commit, not the workflow ref', () => {
  const action = fs.readFileSync(
    path.join(repoRoot, '.github/actions/publish-dev-package/action.yml'),
    'utf8'
  );
  assert.match(action, /^\s{2}commit:$/m, 'the action must accept a source commit');
  assert.match(action, /COMMIT_SHA: \$\{\{ inputs\.commit \|\| github\.sha \}\}/);
});

// The nightly schedule is paused (issue #319): only a dispatch runs it, and the commented cron stays ready to restore.
test('ci-nightly runs on dispatch while its nightly schedule is paused', () => {
  const {on} = load('ci-nightly.yml');
  assert.deepEqual(Object.keys(on).sort(), ['workflow_dispatch'], 'ci-nightly trigger set');
  const text = fs.readFileSync(path.join(workflowDir, 'ci-nightly.yml'), 'utf8');
  assert.match(text, /^\s*#\s*schedule:\s*$/m, 'the paused schedule must stay in the file, commented out');
  assert.match(text, /^\s*#\s*- cron: '[^']+'\s*$/m, 'the paused cron must stay in the file, commented out');
});

test('runs on main never share a concurrency group', () => {
  assert.match(
    load('ci-pr-checks.yml').concurrency.group,
    /github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id/
  );
});

test('ci-pr-checks calls every folder workflow, and the gate needs all of them', () => {
  const {jobs} = load('ci-pr-checks.yml');
  for (const folder of FOLDERS) {
    assert.equal(jobs[folder]?.uses, `./.github/workflows/ci-${folder}.yml`, `${folder} needs a pipeline`);
    assert.ok(fs.existsSync(path.join(workflowDir, `ci-${folder}.yml`)));
    assert.match(
      jobs[folder].if,
      new RegExp(
        `needs\\.plan\\.outputs\\.${folder} == 'true' \\|\\| needs\\.plan-test-run\\.outputs\\.${folder} == 'true'`
      )
    );
    assert.match(jobs[folder].if, /!cancelled\(\)/);
  }
  const {gate} = jobs;
  assert.equal(gate.name, 'CI gate', 'the ruleset requires this exact name');
  assert.equal(gate.if, 'always()');
  const jobsAfterGate = ['gate', 'job-times'];
  assert.deepEqual(new Set(gate.needs), new Set(Object.keys(jobs).filter(job => !jobsAfterGate.includes(job))));
  // Gate needs actions:read to fetch jobs for the run budget check.
  assert.deepEqual(gate.permissions, {actions: 'read'}, 'gate permissions must be exactly actions:read');
});

test('CI gate checks run budget with aim and limit env vars', () => {
  const {gate} = load('ci-pr-checks.yml').jobs;
  const stepsText = JSON.stringify(gate.steps);
  assert.match(stepsText, /Check run budget/, 'gate must have a run budget step');
  assert.equal(gate.env.RUN_AIM_SECONDS, 300, 'gate must define RUN_AIM_SECONDS');
  assert.equal(gate.env.RUN_LIMIT_SECONDS, 420, 'gate must define RUN_LIMIT_SECONDS');
  assert.match(stepsText, /run-budget\.mjs/, 'run budget step must use run-budget.mjs');
});

// Behavior tests for the real "Check run budget" step.
// Extract the gate's run script, run it with `bash -e` (as GitHub does), with a fake `gh`
// that returns jobs JSON whose approval job completed at a controlled time.
const {gate: gateJob} = load('ci-pr-checks.yml').jobs;
const runBudgetStep = gateJob.steps.find(step => step.name === 'Check run budget');
const runBudgetScript = runBudgetStep.run;

// Build a jobs JSON response with the approval job completed at a given offset (seconds ago).
function makeJobsJson(secondsAgo) {
  const completedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
  return JSON.stringify({
    jobs: [
      {name: 'Approve CI run', completed_at: completedAt, started_at: completedAt}
    ]
  });
}

// Run the "Check run budget" step script in a temp dir with a fake `gh` and the real run-budget.mjs.
// The fake gh serves both the attempt endpoint (for run_started_at) and the jobs endpoint.
// Returns {code, stdout, stderr}.
async function runBudgetBehaviorTest(jobsJson, shouldFailGh, attemptJson) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'run-budget-behavior-'));

  // Create the fake gh script that distinguishes between the attempt and jobs endpoints.
  const jobsEscaped = jobsJson.replace(/'/g, "'\\''");
  const attemptEscaped = (attemptJson ?? '{}').replace(/'/g, "'\\''");
  const ghScript = `#!/usr/bin/env bash
if [ "${shouldFailGh}" = "true" ]; then
  echo "API error" >&2
  exit 1
fi
case "$@" in
  *'/attempts/'*/jobs*)
    echo '${jobsEscaped}'
    ;;
  *'/attempts/'*)
    echo '${attemptEscaped}'
    ;;
  *)
    echo '${jobsEscaped}'
    ;;
esac
`;
  const ghPath = path.join(temporaryDirectory, 'gh');
  await fs.promises.writeFile(ghPath, ghScript);
  await fs.promises.chmod(ghPath, 0o755);

  // Copy the run-budget.mjs script into the temp dir under platform/tools
  const toolsDirectory = path.join(temporaryDirectory, 'platform', 'tools');
  await fs.promises.mkdir(toolsDirectory, {recursive: true});
  const runBudgetSource = path.join(repoRoot, 'platform', 'tools', 'run-budget.mjs');
  await fs.promises.copyFile(runBudgetSource, path.join(toolsDirectory, 'run-budget.mjs'));

  const env = {
    PATH: temporaryDirectory + ':' + process.env.PATH,
    GH_TOKEN: 'fake-token',
    GH_REPO: 'owner/repo',
    RUN_ID: '123',
    RUN_ATTEMPT: '1',
    EVENT_NAME: 'pull_request',
    RUN_AIM_SECONDS: '300',
    RUN_LIMIT_SECONDS: '420',
    APPROVAL_JOB_NAME: 'Approve CI run',
    GITHUB_STEP_SUMMARY: path.join(temporaryDirectory, 'summary'),
  };

  try {
    const result = await execFileAsync('bash', ['-e', '-c', runBudgetScript], {env, cwd: temporaryDirectory});
    return {code: 0, stdout: result.stdout, stderr: result.stderr};
  } catch (err) {
    return {code: err.code, stdout: err.stdout || '', stderr: err.stderr || ''};
  } finally {
    await fs.promises.rm(temporaryDirectory, {recursive: true, force: true});
  }
}

test('run budget: over the limit exits 1 with ::error::', async () => {
  // 500s ago — over the 420s limit.
  const result = await runBudgetBehaviorTest(makeJobsJson(500), false);
  assert.equal(result.code, 1, 'over the limit must exit 1');
  assert.match(result.stdout, /::error::/, 'over the limit must emit ::error::');
});

test('run budget: between aim and limit exits 0 with ::warning::', async () => {
  // 360s ago — between 300s aim and 420s limit.
  const result = await runBudgetBehaviorTest(makeJobsJson(360), false);
  assert.equal(result.code, 0, 'between aim and limit must exit 0');
  assert.match(result.stdout, /::warning::/, 'between aim and limit must emit ::warning::');
});

test('run budget: under the aim exits 0 with no warning', async () => {
  // 200s ago — under the 300s aim.
  const result = await runBudgetBehaviorTest(makeJobsJson(200), false);
  assert.equal(result.code, 0, 'under the aim must exit 0');
  assert.doesNotMatch(result.stdout, /::warning::/, 'under the aim must not warn');
  assert.doesNotMatch(result.stdout, /::error::/, 'under the aim must not error');
});

test('run budget: gh fails exits 0 with ::warning::', async () => {
  const result = await runBudgetBehaviorTest('', true);
  assert.equal(result.code, 0, 'gh failure must exit 0');
  assert.match(result.stdout, /::warning::/, 'gh failure must emit ::warning::');
});

test('run budget: script crashes exits 0 with ::warning::', async () => {
  // Point the script at a missing file by using a bad script path.
  // We simulate this by having the fake gh succeed but providing invalid JSON.
  const result = await runBudgetBehaviorTest('not-valid-json', false);
  assert.equal(result.code, 0, 'script crash must exit 0');
  // The script outputs "unreadable" verdict, which the step treats as a warning.
  assert.match(result.stdout, /::warning::/, 'script crash must emit ::warning::');
});

// Real data: run 43710253591, attempt 2
// Approval completed at 11:43:04Z, attempt started at 12:15:04Z, gate at 12:15:17Z.
// Without run_started_at: 1933s from approval → fail. With run_started_at: 13s → ok.
test('run budget: rerun with run_started_at uses attempt start, not approval (run 43710253591)', async () => {
  // Simulate a rerun: approval was long ago, but the attempt just started.
  // The attempt endpoint returns a recent run_started_at.
  const approvalCompleted = new Date(Date.now() - 1933_000).toISOString();
  const runStartedAt = new Date(Date.now() - 13_000).toISOString();
  const jobsJson = JSON.stringify({
    jobs: [
      {name: 'Approve CI run', completed_at: approvalCompleted, started_at: approvalCompleted}
    ]
  });
  const attemptJson = JSON.stringify({run_started_at: runStartedAt});
  const result = await runBudgetBehaviorTest(jobsJson, false, attemptJson);
  assert.equal(result.code, 0, 'rerun with run_started_at must exit 0 (ok)');
  assert.doesNotMatch(result.stdout, /::error::/, 'rerun must not error');
  assert.match(result.stdout, /13s elapsed/, 'elapsed must be 13s from attempt start');
});

test('run budget: first run with run_started_at earlier than approval uses approval', async () => {
  // On a first run, run_started_at is before the approval. The effective start is the approval.
  const approvalCompleted = new Date(Date.now() - 200_000).toISOString();
  const runStartedAt = new Date(Date.now() - 300_000).toISOString();
  const jobsJson = JSON.stringify({
    jobs: [
      {name: 'Approve CI run', completed_at: approvalCompleted, started_at: approvalCompleted}
    ]
  });
  const attemptJson = JSON.stringify({run_started_at: runStartedAt});
  const result = await runBudgetBehaviorTest(jobsJson, false, attemptJson);
  assert.equal(result.code, 0, 'first run must exit 0');
  assert.match(result.stdout, /200s elapsed/, 'elapsed must be 200s from approval, not run_started_at');
});


test('only the new pipelines run on the repository', () => {
  const others = fs.readdirSync(workflowDir).filter(file => !newWorkflowFiles.includes(file));
  assert.deepEqual(others, [], 'a workflow outside ci-pr-checks would run on every PR whatever changed');
  // ci-publish runs on push to main and workflow_dispatch;
  // cd-dev-pages runs on workflow_run (ci-publish completed on main) and workflow_dispatch;
  // ci-nightly runs on schedule and workflow_dispatch; all other ci-* workflows only run when called or dispatched.
  for (const file of newWorkflowFiles.filter(name => name !== 'ci-pr-checks.yml' && name !== 'ci-publish.yml' && name !== 'ci-nightly.yml' && name !== 'cd-dev-pages.yml' && !name.startsWith('cd-'))) {
    assert.deepEqual(
      Object.keys(load(file).on).sort(),
      ['workflow_call', 'workflow_dispatch'],
      `${file} must run only when called`
    );
  }
  assert.equal(
    load('ci-pr-checks.yml').on.pull_request,
    null,
    'a filter on a required workflow would leave its check pending forever'
  );
});

test('browser jobs run only the planned areas, and none when there are none', () => {
  const allJobs = load('ci-pr-checks.yml').jobs;
  const plannedMatrixByApp = {'apps-web': 'browser_matrix', 'apps-editor': 'editor_browser_matrix'};
  for (const [app, output] of Object.entries(plannedMatrixByApp)) {
    assert.equal(
      allJobs[app].with.browser_matrix,
      `\${{ needs.plan.outputs.${output} || needs.plan-test-run.outputs.${output} }}`
    );
    const {jobs} = load(`ci-${app}.yml`);
    assert.equal(jobs.browser.if, `\${{ needs.verify.outputs.browser_matrix != '{"include":[]}' }}`);
    assert.equal(jobs['browser-test-run'].if, `\${{ needs.verify-test-run.outputs.browser_matrix != '{"include":[]}' }}`);
  }
});

test('the planner has an output on the plan job for every folder', () => {
  const {plan} = load('ci-pr-checks.yml').jobs;
  assert.deepEqual(new Set(Object.keys(plan.outputs)), new Set([...FOLDERS, 'browser_matrix', 'editor_browser_matrix', 'image_matrix']));
});

test('a release version of the browser image must say which Playwright is inside, and never changes', () => {
  const action = fs.readFileSync(path.join(repoRoot, '.github/actions/promote-browser-image/action.yml'), 'utf8');
  assert.match(action, /playwright\.version/);
  assert.match(action, /already exists/);
  const {jobs} = load('cd-browser-image.yml');
  assert.equal(jobs.publish.environment, 'package-release');
  assert.equal(jobs['publish-test-run'].permissions.packages, 'read', 'a test run must be unable to publish');
});

test('browser jobs and local runs pin one image, whose version matches the repository\'s Playwright', () => {
  const readRoot = file => fs.readFileSync(path.join(repoRoot, file), 'utf8');
  const {version: playwright} = JSON.parse(readRoot('package-lock.json')).packages['node_modules/playwright'];
  const expected = new RegExp(`^ghcr\\.io/ivanov-gv/cg-map/browser-ci:${playwright.replaceAll('.', '\\.')}-r\\d+$`);
  const pins = new Set([readRoot('Makefile').match(/^ACT_IMAGE := (.+)$/m)[1]]);
  const browserJobs = {
    'ci-apps-web.yml': ['browser', 'browser-test-run'],
    'ci-apps-editor.yml': ['browser', 'browser-test-run'],
    'ci-apps-core-demo.yml': ['verify', 'verify-test-run']
  };
  for (const [file, names] of Object.entries(browserJobs)) {
    for (const name of names) {
      const {container} = load(file).jobs[name];
      pins.add(container.image);
      assert.equal(container.credentials?.password, '${{ github.token }}', `${file} ${name} could not pull a private image`);
    }
  }
  assert.equal(pins.size, 1, `every pin must match: ${[...pins].join(', ')}`);
  assert.match([...pins][0], expected);
});

test('a PR runs the phone layout only for tagged tests, and the nightly run runs them all', () => {
  const {jobs} = load('ci-pr-checks.yml');
  for (const app of ['apps-web', 'apps-editor']) {
    assert.equal(jobs[app].with.phone_tests, '${{ inputs.phone_tests || \'tagged\' }}');
    const {browser} = load(`ci-${app}.yml`).jobs;
    assert.equal(browser.env.E2E_PHONE, '${{ inputs.phone_tests }}');
    const config = fs.readFileSync(path.join(repoRoot, app.replace('-', '/'), 'playwright.config.mjs'), 'utf8');
    assert.match(config, /process\.env\.E2E_PHONE === 'tagged' \? \{grep: \/@phone\/\}/);
  }
});

test('the browser image runs the Node version the repository pins', () => {
  const pinnedVersion = fs.readFileSync(path.join(repoRoot, '.node-version'), 'utf8').trim();
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'platform/browser-image/Dockerfile'), 'utf8');
  assert.equal(dockerfile.match(/^ARG NODE_VERSION=(.+)$/m)?.[1], pinnedVersion);
});

// Jobs reference an environment only when they read its variables or secrets.
// GitHub records a deployment for every job that references an environment, so unnecessary references create noise.
// Exception: the approval gate (ci-approval) waits for manual approval.
const ENV_EXCEPTIONS = {
  'ci-pr-checks.yml': ['approval'],
};

test('ci-* production jobs reference dev only when they read vars.* or secrets.*', () => {
  for (const file of newWorkflowFiles.filter(name => name.startsWith('ci-'))) {
    const {jobs} = load(file);
    const exceptions = ENV_EXCEPTIONS[file] ?? [];
    for (const [name, job] of Object.entries(jobs)) {
      // Skip test-run twins, exceptions, and jobs that call other workflows
      if (name.endsWith('-test-run') || exceptions.includes(name) || job.uses) continue;
      const jobText = JSON.stringify(job);
      const readsVarsOrSecrets = /\$\{\{[^}]*\bvars\./.test(jobText) || /\$\{\{[^}]*\bsecrets\./.test(jobText);
      const environment = typeof job.environment === 'string' ? job.environment : job.environment?.name;
      if (readsVarsOrSecrets) {
        assert.equal(environment, 'dev', `${file} ${name} reads vars/secrets but does not reference dev`);
      } else {
        assert.equal(environment, undefined, `${file} ${name} should not reference an environment but has ${environment}`);
      }
    }
  }
});

test('ci-* test-run twins always reference test-run', () => {
  for (const file of newWorkflowFiles.filter(name => name.startsWith('ci-'))) {
    const {jobs} = load(file);
    for (const [name, job] of Object.entries(jobs)) {
      if (!name.endsWith('-test-run')) continue;
      const environment = typeof job.environment === 'string' ? job.environment : job.environment?.name;
      assert.equal(environment, 'test-run', `${file} ${name} must reference test-run`);
    }
  }
});

// sparse-checkout must list one pattern per line; a space-separated list is one pattern that matches nothing.
// act cannot catch this because it copies the worktree instead of performing a sparse checkout.
function checkSparseCheckoutSteps(steps, relativePath, entryName) {
  for (const step of steps ?? []) {
    if (step.with?.['sparse-checkout'] !== undefined) {
      const value = step.with['sparse-checkout'];
      assert.equal(
        typeof value,
        'string',
        `${relativePath} ${entryName}: sparse-checkout must be a string`
      );
      const patterns = value.split('\n').map(pattern => pattern.trim()).filter(pattern => pattern.length > 0);
      for (const pattern of patterns) {
        assert.doesNotMatch(
          pattern,
          /\s/,
          `${relativePath} ${entryName}: sparse-checkout pattern must not contain spaces: "${pattern}"`
        );
      }
    }
  }
}

test('sparse-checkout inputs split into newline-separated patterns with no spaces', () => {
  const actionsDirectory = path.join(repoRoot, '.github/actions');
  const actionFiles = fs.readdirSync(actionsDirectory)
    .map(actionDirectory => path.join('.github/actions', actionDirectory, 'action.yml'));
  const allYamlPaths = [...newWorkflowFiles.map(file => path.join(workflowDir, file)), ...actionFiles.map(file => path.join(repoRoot, file))];
  for (const yamlPath of allYamlPaths) {
    const raw = fs.readFileSync(yamlPath, 'utf8');
    const parsed = parseYaml(raw);
    const relativePath = path.relative(repoRoot, yamlPath);
    // Workflows have jobs; composite actions have runs.steps — check both.
    const jobs = parsed.jobs ?? {};
    for (const [name, job] of Object.entries(jobs)) {
      checkSparseCheckoutSteps(job.steps, relativePath, name);
    }
    const actionRuns = parsed.runs;
    if (actionRuns?.steps) {
      checkSparseCheckoutSteps(actionRuns.steps, relativePath, 'runs');
    }
  }
});

test('ci-pr-checks gate sparse-checkout includes both required files', () => {
  const {gate} = load('ci-pr-checks.yml').jobs;
  const checkoutStep = gate.steps.find(
    step => step.uses?.startsWith('actions/checkout') && step.with?.['sparse-checkout']
  );
  assert.ok(checkoutStep, 'gate must have a checkout with sparse-checkout');
  const patterns = checkoutStep.with['sparse-checkout']
    .split('\n')
    .map(pattern => pattern.trim())
    .filter(pattern => pattern.length > 0);
  assert.ok(patterns.includes('.node-version'), 'gate sparse-checkout must include .node-version');
  assert.ok(patterns.includes('platform/tools/run-budget.mjs'), 'gate sparse-checkout must include platform/tools/run-budget.mjs');
});

test('cd-dev-pages extracts /site/ contents, not /usr/share/nginx/html', () => {
  const stepsText = JSON.stringify(load('cd-dev-pages.yml').jobs.find.steps);
  assert.match(stepsText, /\/site\/\./, 'must copy /site/ contents into pages-dist');
  assert.doesNotMatch(stepsText, /\/usr\/share\/nginx\/html/, 'must not reference nginx path');
});

test('platform/pages/Dockerfile uses FROM scratch and copies to /site', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'platform/pages/Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM scratch/, 'must use FROM scratch');
  assert.match(dockerfile, /COPY \. \/site/, 'must copy build context to /site');
  assert.match(dockerfile, /CMD/, 'must have a CMD so docker create works');
  assert.doesNotMatch(dockerfile, /FROM nginx/, 'must not use nginx base');
});

test('ci-publish pages job does not use ${{ }} in run: blocks', () => {
  const {jobs} = load('ci-publish.yml');
  for (const step of jobs.pages.steps ?? []) {
    if (step.run) {
      assert.doesNotMatch(
        step.run,
        /\$\{\{[^}]*inputs\./,
        'pages step "' + step.name + '" must not use ${{ inputs.* }} in run:'
      );
    }
  }
});

test('cd-dev-pages find job does not use ${{ }} in run: blocks', () => {
  const {jobs} = load('cd-dev-pages.yml');
  for (const step of jobs.find.steps ?? []) {
    if (step.run) {
      assert.doesNotMatch(
        step.run,
        /\$\{\{/,
        'find step "' + step.name + '" must not use ${{ }} in run:'
      );
    }
  }
});

test('ci-publish pages-cleanup maps DEV_PAGES_PACKAGE and DEV_PAGES_VERSIONS_TO_KEEP from vars', () => {
  const {jobs} = load('ci-publish.yml');
  const cleanup = jobs['pages-cleanup'];
  assert.equal(cleanup.env.DEV_PAGES_PACKAGE, '${{ vars.DEV_PAGES_PACKAGE }}');
  assert.equal(cleanup.env.DEV_PAGES_VERSIONS_TO_KEEP, '${{ vars.DEV_PAGES_VERSIONS_TO_KEEP }}');
  // The step uses env vars, not hardcoded values
  const stepsText = JSON.stringify(cleanup.steps);
  assert.match(stepsText, /env\.DEV_PAGES_PACKAGE/);
  assert.match(stepsText, /env\.DEV_PAGES_VERSIONS_TO_KEEP/);
});

test('ci-publish pages-cleanup has a test-run twin with packages: read', () => {
  const {jobs} = load('ci-publish.yml');
  const twin = jobs['pages-cleanup-test-run'];
  assert.ok(twin, 'pages-cleanup-test-run must exist');
  assert.equal(twin.environment, 'test-run');
  assert.equal(twin.permissions.packages, 'read', 'test-run cleanup must not write packages');
  assert.deepEqual(twin.steps, jobs['pages-cleanup'].steps, 'twin must share steps');
});

test('publish-image action generalised with name, dockerfile, commit, skip_main_tag inputs', () => {
  const action = fs.readFileSync(path.join(repoRoot, '.github/actions/publish-image/action.yml'), 'utf8');
  assert.match(action, /name:/, 'must have name input');
  assert.match(action, /dockerfile:/, 'must have dockerfile input');
  assert.match(action, /commit:/, 'must have commit input');
  assert.match(action, /skip_main_tag:/, 'must have skip_main_tag input');
});

test('ci-publish pages job uses publish-image action with skip_main_tag', () => {
  const {jobs} = load('ci-publish.yml');
  const publishStep = jobs.pages.steps.find(s => s.uses?.includes('publish-image'));
  assert.ok(publishStep, 'pages must use publish-image action');
  assert.equal(publishStep.with.name, 'dev-pages');
  assert.equal(publishStep.with.skip_main_tag, 'true');
  // Dockerfile comes from the workflow checkout, not from source/.
  // Build context is the site/ directory, because the root .dockerignore excludes it otherwise.
  assert.equal(publishStep.with.dockerfile, 'platform/pages/Dockerfile', 'must use workflow checkout Dockerfile');
  assert.equal(publishStep.with.context, 'site', 'must use site/ as build context');
});

// Read the publish-image action definition to know which inputs are required.
const publishImageAction = parseYaml(
  fs.readFileSync(path.join(repoRoot, '.github/actions/publish-image/action.yml'), 'utf8')
);
const publishImageRequiredInputs = Object.entries(publishImageAction.inputs ?? {})
  .filter(([, input]) => input.required)
  .map(([name]) => name);

test('every publish-image caller passes all required inputs', () => {
  // Find all steps across all workflows that use the publish-image action.
  for (const file of newWorkflowFiles) {
    const {jobs} = load(file);
    for (const [jobName, job] of Object.entries(jobs)) {
      for (const step of job.steps ?? []) {
        if (!step.uses?.includes('publish-image')) continue;
        for (const requiredInput of publishImageRequiredInputs) {
          assert.ok(
            step.with?.[requiredInput] !== undefined,
            `${file} ${jobName} publish-image step must pass required input ${requiredInput}`
          );
        }
      }
    }
  }
});

test('ci-publish pages job passes dev-pages name and commit from env', () => {
  const {jobs} = load('ci-publish.yml');
  const publishStep = jobs.pages.steps.find(s => s.uses?.includes('publish-image'));
  assert.ok(publishStep, 'pages must use publish-image action');
  assert.equal(publishStep.with.name, 'dev-pages', 'must pass the dev-pages image name');
  assert.equal(publishStep.with.commit, '${{ env.COMMIT }}', 'must pass commit from env, not github.sha');
  assert.equal(publishStep.with.repository, '${{ env.IMAGE_REPOSITORY }}', 'must use IMAGE_REPOSITORY');
  assert.equal(publishStep.with.token, '${{ github.token }}', 'must pass token');
});

test('ci-publish image job uses publish-image action without skip_main_tag', () => {
  const {jobs} = load('ci-publish.yml');
  const publishStep = jobs.image.steps.find(s => s.uses?.includes('publish-image'));
  assert.ok(publishStep, 'image must use publish-image action');
  assert.equal(publishStep.with.name, '${{ env.APP }}');
  assert.equal(publishStep.with.skip_main_tag, undefined, 'app images should not skip main tag');
});

// Run the publish-image action script with a stub docker to verify tag construction.
// The stub records docker build/push arguments for inspection.
const publishImageScript = publishImageAction.runs.steps[0].run;

async function runPublishImageAction(envVars) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'publish-image-test-'));
  const logFile = path.join(temporaryDirectory, 'docker-calls.log');

  // Create a stub docker that records its arguments.
  const stubDocker = `#!/bin/bash
echo "$@" >> '${logFile}'
`;
  await fs.promises.writeFile(path.join(temporaryDirectory, 'docker'), stubDocker);
  await fs.promises.chmod(path.join(temporaryDirectory, 'docker'), 0o755);

  const env = {
    PATH: temporaryDirectory + ':' + process.env.PATH,
    HOME: temporaryDirectory,
    GITHUB_ACTOR: 'test-actor',
    GITHUB_STEP_SUMMARY: path.join(temporaryDirectory, 'summary'),
    ...envVars,
  };

  try {
    const result = await execFileAsync('bash', ['-c', publishImageScript], {env, cwd: temporaryDirectory});
    const calls = fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    return {code: 0, stdout: result.stdout, stderr: result.stderr, calls};
  } catch (err) {
    const calls = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean) : [];
    return {code: err.code, stdout: err.stdout, stderr: err.stderr, calls};
  } finally {
    await fs.promises.rm(temporaryDirectory, {recursive: true, force: true});
  }
}

test('publish-image action tags dev-pages with the commit SHA, not github.sha', async () => {
  const result = await runPublishImageAction({
    IMAGE_NAME: 'dev-pages',
    IMAGE_REPOSITORY: 'ttl.sh/ivanov-gv-cg-map',
    DOCKERFILE: 'platform/pages/Dockerfile',
    COMMIT_SHA: '88563c2685eb6f28062525992dc9a10aca304752',
    REGISTRY_TOKEN: 'fake-token',
    SKIP_MAIN_TAG: 'true',
  });
  assert.equal(result.code, 0, 'action script should succeed: ' + result.stderr);

  // Find the docker build call and verify the tag.
  const buildCall = result.calls.find(c => c.startsWith('build'));
  assert.ok(buildCall, 'should have a docker build call');
  assert.match(
    buildCall,
    /--tag\s+ttl\.sh\/ivanov-gv-cg-map\/dev-pages:88563c2685eb6f28062525992dc9a10aca304752/,
    'build tag must be repository/dev-pages:COMMIT_SHA'
  );
  // Should not have a :main tag when skip_main_tag is true.
  assert.doesNotMatch(buildCall, /:main/, 'should not tag as main when skip_main_tag is true');

  // Verify the push call uses the same tag.
  const pushCall = result.calls.find(c => c.startsWith('push'));
  assert.ok(pushCall, 'should have a docker push call');
  assert.match(
    pushCall,
    /ttl\.sh\/ivanov-gv-cg-map\/dev-pages:88563c2685eb6f28062525992dc9a10aca304752/,
    'push must use the commit-tagged image'
  );
});

test('publish-image action tags app images with both commit SHA and main', async () => {
  const result = await runPublishImageAction({
    IMAGE_NAME: 'web',
    IMAGE_REPOSITORY: 'ghcr.io/ivanov-gv/cg-map',
    DOCKERFILE: '',
    COMMIT_SHA: 'abc123def456',
    REGISTRY_TOKEN: 'fake-token',
    SKIP_MAIN_TAG: 'false',
  });
  assert.equal(result.code, 0, 'action script should succeed: ' + result.stderr);

  const buildCall = result.calls.find(c => c.startsWith('build'));
  assert.ok(buildCall, 'should have a docker build call');
  assert.match(
    buildCall,
    /--tag\s+ghcr\.io\/ivanov-gv\/cg-map\/web:abc123def456/,
    'build must include commit tag'
  );
  assert.match(
    buildCall,
    /--tag\s+ghcr\.io\/ivanov-gv\/cg-map\/web:main/,
    'build must include main tag for app images'
  );
});

test('publish-image action uses build context from context input', async () => {
  const result = await runPublishImageAction({
    IMAGE_NAME: 'dev-pages',
    IMAGE_REPOSITORY: 'ttl.sh/ivanov-gv-cg-map',
    DOCKERFILE: 'platform/pages/Dockerfile',
    COMMIT_SHA: '88563c2685eb6f28062525992dc9a10aca304752',
    REGISTRY_TOKEN: 'fake-token',
    SKIP_MAIN_TAG: 'true',
    BUILD_CONTEXT: 'site',
  });
  assert.equal(result.code, 0, 'action script should succeed: ' + result.stderr);

  const buildCall = result.calls.find(c => c.startsWith('build'));
  assert.ok(buildCall, 'should have a docker build call');
  assert.match(
    buildCall,
    /site$/,
    'build must use the context path from the context input'
  );
});

// Any job that checks out a non-default ref must keep local actions on the
// workflow's own checkout. The first checkout must have no ref; the one with
// ref must have a path. This prevents the root cause of #244 where checking
// out ref: <commit> resolved ./.github/actions to main's old versions.
test('ci-publish pages job keeps local actions on workflow checkout', () => {
  const {jobs} = load('ci-publish.yml');
  const pagesSteps = jobs.pages.steps;

  // Find all checkout steps
  const checkouts = pagesSteps
    .map((step, index) => ({step, index}))
    .filter(({step}) => step.uses?.startsWith('actions/checkout'));

  assert.ok(checkouts.length >= 2, 'pages must have at least two checkouts');

  // The first checkout must not have a ref (gets this branch's actions)
  const firstCheckout = checkouts[0].step;
  assert.equal(
    firstCheckout.with?.ref,
    undefined,
    'first checkout must not specify ref so local actions come from the workflow branch'
  );
  assert.equal(
    firstCheckout.with?.path,
    undefined,
    'first checkout must not specify path so actions are at the root'
  );

  // A checkout with ref must have a path (source subdirectory)
  const refCheckout = checkouts.find(({step}) => step.with?.ref !== undefined);
  assert.ok(refCheckout, 'pages must have a checkout with ref for the source commit');
  assert.ok(
    refCheckout.step.with?.path,
    'checkout with ref must have a path to avoid overwriting local actions'
  );
});

// Prove the pattern is necessary: if the first checkout had ref but no path,
// the local actions would resolve to the wrong commit.
test('ci-publish pages would fail with single checkout of non-default ref', () => {
  // This test verifies that the pages job does NOT use a single checkout
  // with ref but no path — the pattern that caused #244.
  const {jobs} = load('ci-publish.yml');
  const pagesSteps = jobs.pages.steps;
  const checkouts = pagesSteps.filter(step => step.uses?.startsWith('actions/checkout'));

  // Count checkouts that have ref but no path (the bad pattern)
  const badCheckouts = checkouts.filter(
    step => step.with?.ref !== undefined && step.with?.path === undefined
  );
  assert.equal(
    badCheckouts.length,
    0,
    'no checkout should have ref without path — this caused #244 (invalid tag ttl.sh/ivanov-gv-cg-map/:037f5e9...)'
  );
});
