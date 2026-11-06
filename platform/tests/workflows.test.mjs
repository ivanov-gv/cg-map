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
  'ci-all.yml': ['approval', 'switch', 'gate', 'dev-pages', ...FOLDERS],
  'ci-workflows.yml': ['test-run-evidence'],
  'cd-map-core.yml': ['switch'],
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

test('CD checks out no application source, and only a release or a manual run can start it', () => {
  const {jobs, permissions, on} = load('cd-map-core.yml');
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
  assert.match(jobs.switch.if, /startsWith\(github\.event\.release\.tag_name, 'map-core\/v'\)/);
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

test('only a dedicated job writes packages, and only from main unless it is a test run', () => {
  for (const file of ['ci-map-core.yml', 'ci-apps-editor.yml', 'ci-apps-core-demo.yml', 'ci-apps-web.yml']) {
    const {jobs} = load(file);
    const writers = Object.entries(jobs).filter(([, job]) => job.permissions?.packages === 'write');
    assert.equal(writers.length, 1, `${file} must have one job that writes packages`);
    const [[writerName, writer]] = writers;
    assert.match(writer.if, /github\.ref == 'refs\/heads\/main'/, `${file} ${writerName} could publish from a branch`);
    assert.equal(jobs[`${writerName}-test-run`].permissions.packages, 'read');
  }
});

test('CD refuses a commit that is not on main', () => {
  const stepsText = JSON.stringify(load('cd-map-core.yml').jobs.switch.steps);
  assert.match(stepsText, /compare\/main\.\.\./);
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
  const publishing = {
    'map-core': 'publish_package',
    'apps-web': 'publish_image',
    'apps-editor': 'publish_image',
    'apps-core-demo': 'publish_image'
  };
  for (const [name, input] of Object.entries(publishing)) {
    assert.equal(
      jobs[name].with[input],
      "${{ github.event_name == 'push' || needs.switch.outputs.test_run == 'true' }}"
    );
  }
  assert.match(jobs['dev-pages'].if, /github\.event_name == 'push' \|\| needs\.switch\.outputs\.test_run == 'true'/);
  assert.match(jobs['dev-pages'].if, /needs\.gate\.result == 'success'/);
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
  const jobsAfterGate = ['gate', 'dev-pages'];
  assert.deepEqual(new Set(gate.needs), new Set(Object.keys(jobs).filter(job => !jobsAfterGate.includes(job))));
  assert.deepEqual(gate.permissions, {});
});

test('only the new pipelines run on the repository', () => {
  const others = fs.readdirSync(workflowDir).filter(file => !newWorkflowFiles.includes(file));
  assert.deepEqual(others, [], 'a workflow outside ci-all would run on every PR whatever changed');
  for (const file of newWorkflowFiles.filter(name => name !== 'ci-all.yml' && name !== 'cd-map-core.yml')) {
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
  assert.match(allJobs.plan.env.FULL_BROWSER, /github\.event_name != 'pull_request'/);
  const planScript = allJobs.plan.steps.find(step => step.id === 'plan').run;
  assert.match(planScript, /"\$FULL_BROWSER" = true.*full_browser=--full-browser/);
  assert.match(planScript, /--base "\$PLAN_BASE" \$full_browser/);
});

test('the planner has an output on the plan job for every folder', () => {
  const {plan} = load('ci-all.yml').jobs;
  assert.deepEqual(new Set(Object.keys(plan.outputs)), new Set([...FOLDERS, 'browser_matrix']));
});
