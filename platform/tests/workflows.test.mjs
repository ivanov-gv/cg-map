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
  'ci-all.yml': ['switch', 'gate', ...FOLDERS],
  'ci-workflows.yml': ['test-run-evidence'],
  'cd-pages.yml': ['switch']
};

// Each twin is chosen by the mode directly, or by depending on a job that was.
function assertSelectedByMode(jobs, job) {
  const twin = `${job}-test-run`;
  const dependsOnTwin = [jobs[job].needs].flat().some(need => need && jobs[`${need}-test-run`])
    && [jobs[twin].needs].flat().every(need => need?.endsWith('-test-run'));
  if (dependsOnTwin) return;
  const conditions = [jobs[job].if, jobs[twin].if];
  const inputChoice = /inputs\.test_run != true/.test(conditions[0]) && /inputs\.test_run == true/.test(conditions[1]);
  const switchChoice = /test_run != 'true'/.test(conditions[0]) && /test_run == 'true'/.test(conditions[1]);
  assert.ok(inputChoice || switchChoice, `${job} and its twin need opposite test_run conditions: ${conditions.join(' | ')}`);
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
      if (jobs[job].env) assert.deepEqual(Object.keys(twin.env), Object.keys(jobs[job].env), `${job} and its twin must define the same env`);
    }
  });

  test(`${file}: steps never read the test-run mode or secrets directly`, () => {
    for (const [name, job] of Object.entries(load(file).jobs)) {
      const stepsText = JSON.stringify(job.steps ?? []);
      assert.doesNotMatch(stepsText, /\$\{\{\s*(secrets|vars)\./, `${name} steps must read secrets and vars through env`);
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
      if (environment) assert.ok(['dev', 'test-run'].includes(environment), `${file} ${name} uses ${environment}`);
      for (const permission of ['pages', 'id-token']) {
        assert.equal(job.permissions?.[permission], undefined, `${file} ${name} must not request ${permission}`);
      }
    }
    assert.equal(load(file).permissions.contents, 'read', `${file} must default to read-only`);
  }
});

test('CD checks out no application source and publishes only from production', () => {
  const {jobs, permissions} = load('cd-pages.yml');
  assert.deepEqual(permissions, {});
  const checkouts = Object.values(jobs).flatMap(job => job.steps ?? []).filter(step => step.uses?.startsWith('actions/checkout'));
  for (const checkout of checkouts) {
    assert.equal(checkout.with['sparse-checkout'], '.github/actions');
    assert.equal(checkout.with['sparse-checkout-cone-mode'], false, 'cone mode would also check out root files');
  }
  const publishers = Object.entries(jobs).filter(([, job]) => (job.steps ?? []).some(step => step.uses?.startsWith('actions/deploy-pages')));
  assert.deepEqual(publishers.map(([name]) => name), ['deploy']);
  assert.deepEqual(jobs['deploy-test-run'].permissions, {});
  assert.equal(jobs['deploy-test-run'].steps.some(step => step.uses), false, 'the test-run deploy only logs');
});

test('CD steps that pipe API calls fail when a call fails', () => {
  const {prepare} = load('cd-pages.yml').jobs;
  const piping = prepare.steps.filter(step => step.run?.includes('| jq'));
  assert.ok(piping.length > 0);
  for (const step of piping) assert.equal(step.shell, 'bash', `${step.name} needs explicit bash for pipefail`);
});

test('CD refuses a pushed artifact that did not come from main', () => {
  const {prepare} = load('cd-pages.yml').jobs;
  const source = prepare.steps.find(step => step.id === 'source').run;
  assert.match(source, /\[ "\$event" != push \] \|\| \[ "\$head_branch" = main \] \|\| skip/);
});

test('runs on main never share a concurrency group', () => {
  assert.match(load('ci-all.yml').concurrency.group, /github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id/);
});

test('ci-all calls every folder workflow, and the gate needs all of them', () => {
  const {jobs} = load('ci-all.yml');
  for (const folder of FOLDERS) {
    assert.equal(jobs[folder]?.uses, `./.github/workflows/ci-${folder}.yml`, `${folder} needs a pipeline`);
    assert.ok(fs.existsSync(path.join(workflowDir, `ci-${folder}.yml`)));
    assert.match(jobs[folder].if, new RegExp(`needs\\.plan\\.outputs\\.${folder} == 'true' \\|\\| needs\\.plan-test-run\\.outputs\\.${folder} == 'true'`));
    assert.match(jobs[folder].if, /!cancelled\(\)/);
  }
  const {gate} = jobs;
  assert.equal(gate.name, 'CI gate', 'the ruleset requires this exact name');
  assert.equal(gate.if, 'always()');
  assert.deepEqual(new Set(gate.needs), new Set(Object.keys(jobs).filter(job => job !== 'gate')));
  assert.deepEqual(gate.permissions, {});
});

test('only the new pipelines run on the repository', () => {
  const others = fs.readdirSync(workflowDir).filter(file => !newWorkflowFiles.includes(file));
  assert.deepEqual(others, [], 'a workflow outside ci-all would run on every PR whatever changed');
  for (const file of newWorkflowFiles.filter(name => name !== 'ci-all.yml' && name !== 'cd-pages.yml')) {
    assert.deepEqual(Object.keys(load(file).on).sort(), ['workflow_call', 'workflow_dispatch'], `${file} must run only when called`);
  }
  assert.equal(load('ci-all.yml').on.pull_request, null, 'a filter on a required workflow would leave its check pending forever');
});

test('only deployable runs compete for the deployment queue', () => {
  const {concurrency, jobs} = load('cd-pages.yml');
  assert.equal(concurrency, undefined, 'at workflow level, a docs merge could replace a pending web deployment');
  for (const job of ['deploy', 'deploy-test-run']) assert.deepEqual(jobs[job].concurrency, {group: 'cd-pages', 'cancel-in-progress': false});
});

test('CD starts automatically only from successful pushes to main', () => {
  const {on, jobs} = load('cd-pages.yml');
  assert.deepEqual(on.workflow_run, {workflows: ['ci-all'], types: ['completed'], branches: ['main']});
  assert.match(jobs.switch.if, /workflow_run\.event == 'push' && github\.event\.workflow_run\.conclusion == 'success'/);
  assert.equal(on.push, undefined);
});

test('browser jobs run only the planned areas, and none when there are none', () => {
  const {jobs} = load('ci-apps-web.yml');
  const allJobs = load('ci-all.yml').jobs;
  assert.match(allJobs['apps-web'].with.browser_matrix, /needs\.plan\.outputs\.browser_matrix \|\| needs\.plan-test-run\.outputs\.browser_matrix/);
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
