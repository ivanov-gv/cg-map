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
  'cd-browser-image.yml': ['switch'],
  'cd-dev-pages.yml': ['switch', 'deploy'],
  'ci-dev-pages.yml': ['switch'],
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

const CD_TAGS = {'cd-map-core.yml': 'map-core/v', 'cd-browser-image.yml': 'browser-image/v'};

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

test('build always takes every app, because it replaces the whole site', () => {
  const stepsText = JSON.stringify(load('ci-dev-pages.yml').jobs.build.steps);
  assert.match(stepsText, /for app in web editor core-demo/);
  // No longer pulls :main images — builds from source instead.
  assert.doesNotMatch(stepsText, /:main/);
  // Writes version.json with commit, run_id, and built_at.
  assert.match(stepsText, /version\.json/);
  assert.match(stepsText, /GITHUB_SHA/);
  assert.match(stepsText, /GITHUB_RUN_ID/);
  const appDirectories = fs.readdirSync(path.join(repoRoot, 'apps'));
  assert.deepEqual(appDirectories.toSorted(), ['core-demo', 'editor', 'web']);
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
  assert.deepEqual(writers.map(([name]) => name).toSorted(), ['browser-image', 'image', 'package']);
  for (const [name, writer] of writers) {
    assert.match(writer.if, /github\.ref == 'refs\/heads\/main'/, `${name} could publish from a branch`);
    assert.equal(jobs[`${name}-test-run`].permissions.packages, 'read', `a test run of ${name} must be unable to publish`);
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

test('cd-dev-pages triggers on push to main and workflow_dispatch with commit input', () => {
  const {on} = load('cd-dev-pages.yml');
  assert.ok(on.push, 'cd-dev-pages must trigger on push to main');
  assert.deepEqual(on.push.branches, ['main']);
  assert.ok(on.workflow_dispatch, 'cd-dev-pages must accept workflow_dispatch');
  assert.equal(on.workflow_dispatch.inputs.commit.type, 'string');
  assert.equal(on.workflow_dispatch.inputs.test_run.default, true);
});

test('cd-dev-pages deploy is the only CD job with Pages permissions', () => {
  const {jobs} = load('cd-dev-pages.yml');
  assert.deepEqual(jobs.deploy.permissions, {pages: 'write', 'id-token': 'write'});
  // Deploy on push only when is_newest; on workflow_dispatch always (for rollback).
  // Requires find to have succeeded so a skipped find (test-run) does not deploy.
  assert.match(jobs.deploy.if, /needs\.find\.result == 'success'/);
  assert.match(jobs.deploy.if, /github\.event_name == 'workflow_dispatch'/);
  assert.match(jobs.deploy.if, /needs\.find\.outputs\.is_newest/);
  assert.deepEqual(jobs.deploy.concurrency, {group: 'dev-pages', 'cancel-in-progress': false});
  // find and find-test-run must not have pages permissions
  for (const job of ['find', 'find-test-run']) {
    assert.equal(jobs[job]?.permissions?.pages, undefined, `${job} must not request pages`);
  }
});

test('cd-dev-pages find job uses the find-pages-artifact composite action', () => {
  const stepsText = JSON.stringify(load('cd-dev-pages.yml').jobs.find.steps);
  assert.match(stepsText, /find-pages-artifact/);
});

test('cd-dev-pages has no workflow_call trigger', () => {
  assert.equal(load('cd-dev-pages.yml').on.workflow_call, undefined, 'cd-dev-pages must not use workflow_call');
});

// Run the find-pages-artifact resolve and wait scripts with a stub curl.
// The action's run: blocks are extracted from the YAML and executed in a temp directory
// where fake-curl.sh intercepts all API calls. No network is used.
const findArtifactAction = fs.readFileSync(
  path.join(repoRoot, '.github/actions/find-pages-artifact/action.yml'),
  'utf8'
);
const fakeCurlPath = path.join(repoRoot, 'platform/tests/fixtures/fake-curl.sh');

// Parse the action YAML to extract the resolve and wait step scripts.
const findArtifactYaml = parseYaml(findArtifactAction);
const resolveScript = findArtifactYaml.runs.steps.find(s => s.id === 'resolve').run;
const waitScript = findArtifactYaml.runs.steps.find(s => s.id === 'wait').run;

async function runFindArtifactStep(script, stubFiles, envOverrides = {}) {
  const temporaryDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'find-artifact-test-'));
  const stubDirectory = path.join(temporaryDirectory, 'stub');
  await fs.promises.mkdir(stubDirectory);
  for (const [name, content] of Object.entries(stubFiles)) {
    await fs.promises.writeFile(path.join(stubDirectory, name), content);
  }
  const curlPath = path.join(temporaryDirectory, 'curl');
  await fs.promises.copyFile(fakeCurlPath, curlPath);
  await fs.promises.chmod(curlPath, 0o755);

  const env = {
    PATH: temporaryDirectory + ':' + process.env.PATH,
    GITHUB_OUTPUT: path.join(temporaryDirectory, 'output'),
    GITHUB_STEP_SUMMARY: path.join(temporaryDirectory, 'summary'),
    INPUT_COMMIT: 'abcdef1234567890abcdef1234567890abcdef12',
    EVENT_SHA: 'abcdef1234567890abcdef1234567890abcdef12',
    GH_TOKEN: 'fake-token',
    GH_REPO: 'owner/repo',
    COMMIT: 'abcdef1234567890abcdef1234567890abcdef12',
    FAKE_CURL_DIR: stubDirectory,
    ...envOverrides,
  };

  try {
    const result = await execFileAsync('bash', ['-c', script], {env, cwd: temporaryDirectory});
    return {code: 0, stdout: result.stdout, stderr: result.stderr};
  } catch (err) {
    return {code: err.code, stdout: err.stdout, stderr: err.stderr};
  } finally {
    await fs.promises.rm(temporaryDirectory, {recursive: true, force: true});
  }
}

test('find-pages-artifact: resolve passes when commit is behind main', async () => {
  const result = await runFindArtifactStep(resolveScript, {
    'compare-main-abcdef1234567890abcdef1234567890abcdef12': '{"status":"behind"}',
  });
  assert.equal(result.code, 0, 'resolve must pass when commit is behind main');
});

test('find-pages-artifact: resolve passes when commit is identical to main', async () => {
  const result = await runFindArtifactStep(resolveScript, {
    'compare-main-abcdef1234567890abcdef1234567890abcdef12': '{"status":"identical"}',
  });
  assert.equal(result.code, 0, 'resolve must pass when commit is identical to main');
});

test('find-pages-artifact: resolve fails when commit is ahead of main', async () => {
  const result = await runFindArtifactStep(resolveScript, {
    'compare-main-abcdef1234567890abcdef1234567890abcdef12': '{"status":"ahead"}',
  });
  assert.equal(result.code, 1, 'resolve must fail when commit is ahead of main');
  assert.match(result.stdout, /::error::.*not on main.*ahead/, 'must emit ::error:: with ahead');
});

test('find-pages-artifact: resolve fails when commit has diverged from main', async () => {
  const result = await runFindArtifactStep(resolveScript, {
    'compare-main-abcdef1234567890abcdef1234567890abcdef12': '{"status":"diverged"}',
  });
  assert.equal(result.code, 1, 'resolve must fail when commit has diverged from main');
  assert.match(result.stdout, /::error::.*not on main.*diverged/, 'must emit ::error:: with diverged');
});

test('find-pages-artifact: wait passes when ci-dev-pages run succeeds', async () => {
  const result = await runFindArtifactStep(waitScript, {
    'runs-head-sha-abcdef1234567890abcdef1234567890abcdef12':
      '{"workflow_runs":[{"name":"ci-dev-pages","head_branch":"main","event":"push","id":12345,"status":"completed","conclusion":"success"}]}',
  }, {MAX_ATTEMPTS: '1', POLL_DELAY: '0'});
  assert.equal(result.code, 0, 'wait must pass when ci-dev-pages run succeeds');
});

test('find-pages-artifact: wait fails when ci-dev-pages run concludes with failure', async () => {
  const result = await runFindArtifactStep(waitScript, {
    'runs-head-sha-abcdef1234567890abcdef1234567890abcdef12':
      '{"workflow_runs":[{"name":"ci-dev-pages","head_branch":"main","event":"push","id":12345,"status":"completed","conclusion":"failure"}]}',
  }, {MAX_ATTEMPTS: '1', POLL_DELAY: '0'});
  assert.equal(result.code, 1, 'wait must fail when ci-dev-pages run fails');
  assert.match(result.stdout, /::error::.*failure/, 'must emit ::error:: with failure');
});

test('find-pages-artifact: wait times out when no run is found', async () => {
  const result = await runFindArtifactStep(waitScript, {
    'runs-head-sha-abcdef1234567890abcdef1234567890abcdef12': '{"workflow_runs":[]}',
  }, {MAX_ATTEMPTS: '2', POLL_DELAY: '0'});
  assert.equal(result.code, 1, 'wait must fail when no ci-dev-pages run is found');
  assert.match(result.stdout, /::error::.*Timeout/, 'must emit ::error:: with timeout');
});

test('find-pages-artifact: wait prefers a successful run when a failed run also exists', async () => {
  const result = await runFindArtifactStep(waitScript, {
    'runs-head-sha-abcdef1234567890abcdef1234567890abcdef12':
      '{"workflow_runs":[{"name":"ci-dev-pages","head_branch":"main","event":"push","id":11111,"status":"completed","conclusion":"failure"},{"name":"ci-dev-pages","head_branch":"main","event":"workflow_dispatch","id":22222,"status":"completed","conclusion":"success"}]}',
  }, {MAX_ATTEMPTS: '1', POLL_DELAY: '0'});
  assert.equal(result.code, 0, 'wait must pass when a successful run exists alongside a failed run');
  assert.match(result.stdout, /run 22222 completed successfully/, 'must select the successful run');
});

// Evaluate the deploy job's if: expression against event/is_newest/find-result combinations.
// The deploy must only run on push when is_newest (so older pushes don't overwrite newer sites),
// and must always run on workflow_dispatch when find succeeds (for rollback).
// It must not run when find is skipped (test-run) or fails.
function evaluateDeployIf(expression, context) {
  // Replace GitHub Actions expression syntax with JavaScript equivalents.
  let expr = expression
    .replace(/\$\{\{\s*/g, '')
    .replace(/\s*\}\}/g, '')
    .trim();
  for (const [key, value] of Object.entries(context)) {
    expr = expr.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), JSON.stringify(value));
  }
  // Handle !cancelled() -> context.cancelled
  expr = expr.replace(/!cancelled\(\)/g, '(!context_cancelled)');
  return Function('context_cancelled', 'return ' + expr + ';')();
}

test('cd-dev-pages deploy gating: push only deploys when newest, workflow_dispatch deploys for rollback', () => {
  const deployIf = load('cd-dev-pages.yml').jobs.deploy.if;

  const cases = [
    {event: 'push', isNewest: 'true', findResult: 'success', cancelled: false, wantDeploy: true, label: 'push, newest'},
    {event: 'push', isNewest: 'false', findResult: 'success', cancelled: false, wantDeploy: false, label: 'push, not newest'},
    {event: 'workflow_dispatch', isNewest: 'false', findResult: 'success', cancelled: false, wantDeploy: true, label: 'dispatch, find success, not newest'},
    {event: 'workflow_dispatch', isNewest: 'false', findResult: 'skipped', cancelled: false, wantDeploy: false, label: 'dispatch test run (find skipped)'},
    {event: 'workflow_dispatch', isNewest: 'false', findResult: 'failure', cancelled: false, wantDeploy: false, label: 'find failed'},
  ];

  for (const tc of cases) {
    const got = evaluateDeployIf(deployIf, {
      'github.event_name': tc.event,
      "needs.find.outputs.is_newest": tc.isNewest,
      "needs.find.result": tc.findResult,
    });
    const deployed = got === true;
    assert.equal(
      deployed,
      tc.wantDeploy,
      `${tc.label}: want deploy=${tc.wantDeploy}, got ${deployed} (if: ${deployIf})`
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

test('ci-workflows: setup-web changed, no ci-publish run must fail', async () => {
  const result = await runEvidenceTest(
    ['.github/actions/setup-web/action.yml'],
    {
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[{"displayTitle":"cd-map-core test_run=true"}]',
    }
  );
  assert.equal(result.code, 1, 'setup-web changed without ci-publish run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run ci-publish\.yml --ref.*-f test_run=true/,
    'error must name the ci-publish dispatch command'
  );
});

test('ci-workflows: ci-dev-pages.yml changed, no qualifying run must fail', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-dev-pages.yml'],
    {
      'runs-ci-dev-pages.yml': '[{"displayTitle":"other run"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 1, 'ci-dev-pages.yml changed without qualifying run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run ci-dev-pages\.yml --ref.*-f test_run=true/,
    'error must name the ci-dev-pages dispatch command'
  );
});

test('ci-workflows: ci-dev-pages.yml changed, with qualifying run must pass', async () => {
  const result = await runEvidenceTest(
    ['.github/workflows/ci-dev-pages.yml'],
    {
      'runs-ci-dev-pages.yml': '[{"displayTitle":"ci-dev-pages test_run=true"}]',
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
    }
  );
  assert.equal(result.code, 0, 'ci-dev-pages.yml changed with qualifying run must exit 0');
});

test('ci-workflows: setup-web changed requires ci-dev-pages run', async () => {
  const result = await runEvidenceTest(
    ['.github/actions/setup-web/action.yml'],
    {
      'runs-ci-pr-checks.yml': '[{"displayTitle":"ci-pr-checks test_run=true run_all=true"}]',
      'runs-cd-browser-image.yml': '[]',
      'runs-cd-map-core.yml': '[{"displayTitle":"cd-map-core test_run=true"}]',
    }
  );
  assert.equal(result.code, 1, 'setup-web changed without ci-dev-pages run must exit 1');
  assert.match(
    result.stdout,
    /gh workflow run ci-dev-pages\.yml --ref.*-f test_run=true/,
    'error must name the ci-dev-pages dispatch command'
  );
});

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

test('ci-dev-pages is triggered on pushes to main, not via workflow_call', () => {
  const {on} = load('ci-dev-pages.yml');
  assert.ok(on.push, 'ci-dev-pages must trigger on push to main');
  assert.deepEqual(on.push.branches, ['main']);
  assert.equal(on.workflow_call, undefined, 'ci-dev-pages must not use workflow_call');
});

test('ci-publish has no dev-pages job', () => {
  const {jobs} = load('ci-publish.yml');
  assert.equal(jobs['dev-pages'], undefined, 'ci-publish must not contain a dev-pages job');
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

test('ci-nightly triggers on schedule and workflow dispatch', () => {
  const {on} = load('ci-nightly.yml');
  assert.deepEqual(Object.keys(on).sort(), ['schedule', 'workflow_dispatch'], 'ci-nightly trigger set');
  assert.ok(on.schedule.length > 0, 'ci-nightly must have a schedule trigger');
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
  assert.deepEqual(gate.permissions, {});
});

test('only the new pipelines run on the repository', () => {
  const others = fs.readdirSync(workflowDir).filter(file => !newWorkflowFiles.includes(file));
  assert.deepEqual(others, [], 'a workflow outside ci-pr-checks would run on every PR whatever changed');
  // ci-publish, ci-dev-pages and cd-dev-pages run on push to main and workflow_dispatch;
  // ci-nightly runs on schedule and workflow_dispatch; all other ci-* workflows only run when called or dispatched.
  for (const file of newWorkflowFiles.filter(name => name !== 'ci-pr-checks.yml' && name !== 'ci-publish.yml' && name !== 'ci-nightly.yml' && name !== 'ci-dev-pages.yml' && name !== 'cd-dev-pages.yml' && !name.startsWith('cd-'))) {
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
