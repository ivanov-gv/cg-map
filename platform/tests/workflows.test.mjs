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

test('the planner has an output on the plan job for every folder', () => {
  const {plan} = load('ci-all.yml').jobs;
  assert.deepEqual(new Set(Object.keys(plan.outputs)), new Set(FOLDERS));
});
