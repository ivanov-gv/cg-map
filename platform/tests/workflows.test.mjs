import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import parseYaml from 'markdownlint-cli2/parsers/yaml';
import {FOLDERS} from '../tools/ci-plan.mjs';
import {repoRoot} from '../agents/lib.mjs';

const workflowDir = path.join(repoRoot, '.github/workflows');
const newWorkflowFiles = fs.readdirSync(workflowDir).filter(file => /^(ci|cd)-.*\.yml$/.test(file));
const load = file => parseYaml(fs.readFileSync(path.join(workflowDir, file), 'utf8'));

// Jobs that stand alone, each with its reason in the workflow's comments.
const NO_TWIN = {
  'ci-all.yml': ['approval', 'switch', 'gate', 'publish', 'dev-pages', 'job-times', ...FOLDERS],
  'ci-workflows.yml': ['test-run-evidence'],
  'cd-map-core.yml': ['switch'],
  'cd-browser-image.yml': ['switch'],
  'ci-dev-pages.yml': ['deploy']
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
    assert.ok(production.length > 0);
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

// Pages is the dev environment, so this is the one deploy CI may do. The rest of CI stays away from Pages permissions.
const DEV_PAGES_JOBS = {'ci-dev-pages.yml': ['deploy'], 'ci-all.yml': ['dev-pages']};

test('CI workflows never touch production', () => {
  for (const file of newWorkflowFiles.filter(name => name.startsWith('ci-'))) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      if (DEV_PAGES_JOBS[file]?.includes(name)) continue;
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

for (const [file, tagPrefix] of Object.entries(CD_TAGS)) test(`${file}: CD checks out no application source, and only a release or a manual run can start it`, () => {
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

test('only the dev Pages deploy holds Pages permissions, and a test run cannot reach it', () => {
  const {jobs} = load('ci-dev-pages.yml');
  assert.deepEqual(jobs.deploy.permissions, {pages: 'write', 'id-token': 'write'});
  assert.match(jobs.deploy.if, /inputs\.test_run != true/);
  for (const job of ['assemble', 'assemble-test-run']) assert.equal(jobs[job].permissions.pages, undefined);
  assert.deepEqual(jobs.deploy.concurrency, {group: 'dev-pages', 'cancel-in-progress': false});
});

test('a deploy always takes every app, because it replaces the whole site', () => {
  const stepsText = JSON.stringify(load('ci-dev-pages.yml').jobs.assemble.steps);
  assert.match(stepsText, /for app in web editor core-demo/);
  assert.match(stepsText, /:main/);
  const appDirectories = fs.readdirSync(path.join(repoRoot, 'apps'));
  assert.deepEqual(appDirectories.toSorted(), ['core-demo', 'editor', 'web']);
});

test('jobs below the optional approval survive it being skipped', () => {
  const {jobs} = load('ci-all.yml');
  const statusFunction = /\b(always|cancelled|failure|success)\(\)/;
  for (const [name, job] of Object.entries(jobs)) {
    // A skipped ancestor skips any job whose condition has no status function, on every run but a pull request.
    if (name !== 'approval')
      assert.match(String(job.if), statusFunction, `${name} would be skipped outside pull requests`);
  }
});

test('a called workflow asks for no more than its caller grants, or the whole run fails to start', () => {
  const {jobs, permissions: defaults} = load('ci-all.yml');
  const levels = {none: 0, read: 1, write: 2};
  const allows = (granted, name, level) => levels[granted?.[name] ?? 'none'] >= levels[level];
  for (const [name, job] of Object.entries(jobs).filter(([, candidate]) => candidate.uses)) {
    const granted = job.permissions ?? defaults;
    const called = load(job.uses.replace('./.github/workflows/', ''));
    const requests = [called.permissions, ...Object.values(called.jobs).map(calledJob => calledJob.permissions)];
    for (const request of requests.filter(Boolean)) {
      for (const [permission, level] of Object.entries(request)) {
        assert.ok(allows(granted, permission, level), `${name} asks for ${permission}: ${level}, beyond its caller`);
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
  const others = newWorkflowFiles.filter(file => file.startsWith('ci-') && !['ci-publish.yml', 'ci-all.yml'].includes(file));
  for (const file of others) {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      assert.notEqual(job.permissions?.packages, 'write', `${file} ${name} must leave publishing to ci-publish`);
    }
  }
});

// The aim is 5 minutes, which the job-times job in ci-all warns about. 7 is the limit: see ADR 0006.
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
  const job = load('ci-all.yml').jobs['job-times'];
  assert.equal(job.if, 'always()');
  assert.deepEqual(new Set(job.needs), new Set(['gate', 'publish', 'dev-pages']));
  assert.deepEqual(job.permissions, {actions: 'read'});
  assert.doesNotMatch(job.steps[0].run, /exit 1|::error::/);
});

test('the editor browser jobs cover every spec in both projects', () => {
  const {matrix} = load('ci-apps-editor.yml').jobs.browser.strategy;
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

test('a pull request runs nothing until it is approved', () => {
  const {jobs} = load('ci-all.yml');
  assert.equal(jobs.approval.environment, 'ci-approval');
  assert.match(jobs.approval.if, /pull_request/);
  assert.deepEqual([jobs.switch.needs].flat(), ['approval']);
  const reachesApproval = name => {
    if (name === 'approval') return true;
    return [jobs[name].needs ?? []].flat().some(reachesApproval);
  };
  for (const name of Object.keys(jobs)) assert.ok(reachesApproval(name), `${name} would run before approval`);
});

test('images and dev packages come only from pushes to main or test runs, never from a pull request', () => {
  const {jobs} = load('ci-all.yml');
  assert.equal(jobs.publish.uses, './.github/workflows/ci-publish.yml');
  assert.match(jobs.publish.if, /github\.event_name == 'push' \|\| needs\.switch\.outputs\.test_run == 'true'/);
  assert.match(jobs.publish.if, /needs\.gate\.result == 'success'/);
  assert.match(jobs['dev-pages'].if, /github\.event_name == 'push' \|\| needs\.switch\.outputs\.test_run == 'true'/);
  assert.match(jobs['dev-pages'].if, /needs\.gate\.result == 'success'/);
  assert.match(jobs['dev-pages'].if, /needs\.publish\.result == 'success' \|\| needs\.publish\.result == 'skipped'/);
});

test('a push to main runs no checks, while PRs and the nightly run do', () => {
  const {jobs, on} = load('ci-all.yml');
  for (const folder of FOLDERS) assert.match(jobs[folder].if, /github\.event_name != 'push'/, `${folder} runs on main`);
  assert.ok(on.schedule.length > 0, 'without the nightly run, nothing checks main itself');
  assert.match(jobs.plan.env.RUN_ALL, /github\.event_name == 'schedule'/, 'the nightly run must check everything');
});

test('runs on main never share a concurrency group', () => {
  assert.match(
    load('ci-all.yml').concurrency.group,
    /github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id/
  );
});

test('ci-all calls every folder workflow, and the gate needs all of them', () => {
  const {jobs} = load('ci-all.yml');
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
  const jobsAfterGate = ['gate', 'publish', 'dev-pages', 'job-times'];
  assert.deepEqual(new Set(gate.needs), new Set(Object.keys(jobs).filter(job => !jobsAfterGate.includes(job))));
  assert.deepEqual(gate.permissions, {});
});

test('only the new pipelines run on the repository', () => {
  const others = fs.readdirSync(workflowDir).filter(file => !newWorkflowFiles.includes(file));
  assert.deepEqual(others, [], 'a workflow outside ci-all would run on every PR whatever changed');
  for (const file of newWorkflowFiles.filter(name => name !== 'ci-all.yml' && !name.startsWith('cd-'))) {
    assert.deepEqual(
      Object.keys(load(file).on).sort(),
      ['workflow_call', 'workflow_dispatch'],
      `${file} must run only when called`
    );
  }
  assert.equal(
    load('ci-all.yml').on.pull_request,
    null,
    'a filter on a required workflow would leave its check pending forever'
  );
});

test('browser jobs run only the planned areas, and none when there are none', () => {
  const {jobs} = load('ci-apps-web.yml');
  const allJobs = load('ci-all.yml').jobs;
  assert.match(
    allJobs['apps-web'].with.browser_matrix,
    /needs\.plan\.outputs\.browser_matrix \|\| needs\.plan-test-run\.outputs\.browser_matrix/
  );
  assert.equal(jobs.browser.if, `\${{ needs.verify.outputs.browser_matrix != '{"include":[]}' }}`);
  assert.equal(jobs['browser-test-run'].if, `\${{ needs.verify-test-run.outputs.browser_matrix != '{"include":[]}' }}`);
});

test('the planner has an output on the plan job for every folder', () => {
  const {plan} = load('ci-all.yml').jobs;
  assert.deepEqual(new Set(Object.keys(plan.outputs)), new Set([...FOLDERS, 'browser_matrix', 'image_matrix']));
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
    for (const name of names) pins.add(load(file).jobs[name].container);
  }
  assert.equal(pins.size, 1, `every pin must match: ${[...pins].join(', ')}`);
  assert.match([...pins][0], expected);
});

test('a PR runs the phone layout only for tagged tests, and the nightly run runs them all', () => {
  const {jobs} = load('ci-all.yml');
  for (const app of ['apps-web', 'apps-editor']) {
    assert.equal(jobs[app].with.phone_tests, "${{ github.event_name == 'schedule' && 'all' || 'tagged' }}");
    const {browser} = load(`ci-${app}.yml`).jobs;
    assert.equal(browser.env.E2E_PHONE, '${{ inputs.phone_tests }}');
    const config = fs.readFileSync(path.join(repoRoot, app.replace('-', '/'), 'playwright.config.mjs'), 'utf8');
    assert.match(config, /process\.env\.E2E_PHONE === 'tagged' \? \{grep: \/@phone\/\}/);
  }
});

test('a test that only runs on the phone layout is tagged, or a PR would run it nowhere', () => {
  const specDirectories = ['apps/web/tests/e2e', 'apps/editor/tests/e2e'];
  for (const directory of specDirectories) {
    for (const file of fs.readdirSync(path.join(repoRoot, directory)).filter(name => name.endsWith('.spec.mjs'))) {
      const text = fs.readFileSync(path.join(repoRoot, directory, file), 'utf8');
      for (const body of text.split(/^(?=\s*test\()/m).slice(1)) {
        if (!/test\.skip\(\s*!(isMobile|hasTouch)/.test(body)) continue;
        assert.match(body, /tag: '@phone'/, `${file}: ${body.slice(0, 80)}`);
      }
    }
  }
});
