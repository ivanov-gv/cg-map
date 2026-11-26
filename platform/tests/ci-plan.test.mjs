import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {FOLDERS, classify, formatOutputs, formatSummary, planChanges, imageMatrix} from '../tools/ci-plan.mjs';
import {plans} from '../tools/verify.mjs';
import {repoRoot} from '../agents/lib.mjs';

// Inside CI these would send the test's own plans to the real job's output and summary.
const plannerEnv = {...process.env};
delete plannerEnv.GITHUB_OUTPUT;
delete plannerEnv.GITHUB_STEP_SUMMARY;
const WEB = ['tests', 'apps-web'];
const OUTPUT_NAMES = [
  'image_matrix',
  'ci_in_place_test_runs',
  'ci_test_runs',
  'cd_test_runs',
  'prove_cd_test_runs',
  'manual_test_runs'
];

const cases = [
  ['docs only', ['docs/runbooks/release.md'], ['docs']],
  ['Markdown inside a component', ['apps/web/README.md', 'services/backend/README.md'], ['docs']],
  ['root instructions, whose assertions run with the docs', ['AGENTS.md'], ['docs']],
  ['generated agent rules', ['.claude/rules/go.md'], ['docs']],
  ['Markdown configuration', ['.markdownlint.jsonc'], ['docs']],
  ['Go code', ['services/backend/cmd/server/main.go'], ['backend']],
  ['go.mod', ['services/backend/go.mod'], ['backend']],
  ['Go and docs together', ['services/backend/go.sum', 'docs/README.md'], ['docs', 'backend']],
  ['backend Makefile', ['services/backend/Makefile'], ['platform', 'backend']],
  ['transit relay', ['services/transit-relay/relay.mjs'], ['transit-relay']],
  ['integration tests', ['tests/integration/archive.test.mjs'], ['tests']],
  ['data tools', ['data/tools/pack.py'], ['data']],
  ['data sources', ['data/sources/places.geojson'], ['data', 'tests']],
  ['released artifact', ['data/artifacts/release.json'], ['data', 'tests']],
  ['shared data tool', ['data/tools/app-data.mjs'], ['data', 'tests']],
  [
    'contracts',
    ['packages/contracts/places.schema.json'],
    ['platform', 'contracts', 'data', 'tests']
  ],
  ['web source', ['apps/web/src/interface.js'], WEB],
  ['web browser job count', ['apps/web/browser-jobs.json'], WEB],
  ['web Makefile', ['apps/web/Makefile'], WEB],
  ['web package', ['apps/web/package.json'], WEB],
  ['POI spec runs both projects', ['apps/web/tests/e2e/poi-visibility.spec.mjs'], WEB],
  [
    'shared map runtime',
    ['packages/map-core/src/poi-icons.js'],
    ['platform', 'map-core', 'apps-core-demo']
  ],
  [
    'shared map build helpers',
    ['packages/map-core/tools/assemble.mjs'],
    ['platform', 'map-core', 'apps-core-demo']
  ],
  ['editor source', ['apps/editor/src/app.js'], ['tests', 'apps-editor']],
  ['editor browser job count', ['apps/editor/browser-jobs.json'], ['tests', 'apps-editor']],
  ['source viewer Makefile', ['apps/editor/Makefile'], ['platform', 'tests', 'apps-editor']],
  ['concept app alone', ['apps/core-demo/src/app.js'], ['apps-core-demo']],
  ['concept app package', ['apps/core-demo/package.json'], ['platform', 'apps-core-demo']],
  ['source bundle producer', ['data/tools/editor-bundle.mjs'], ['data', 'tests']],
  ['changeset importer', ['data/tools/apply-changeset.mjs'], ['data', 'tests']],
  ['changeset importer module', ['data/tools/changeset-rules.mjs'], ['data', 'tests']],
  ['LAN certificate tool', ['platform/tools/lan_certificate.py'], ['platform', 'apps-editor']],
  [
    'phone tag parser used by the app tests',
    ['platform/tools/phone-tags.mjs'],
    ['platform', 'apps-web', 'apps-editor']
  ],
  ['data check behind the importer', ['data/tools/check-data.mjs'], ['data', 'tests']],
  ['level policy behind the importer', ['data/tools/apply-place-visibility.mjs'], ['data', 'tests']],
  ['web test fixture in data', ['data/tests/fixtures/podgorica-places.geojson'], ['data']],
  [
    'preview port tool used by every map application',
    ['platform/tools/dev-port.mjs'],
    ['platform', 'apps-web', 'apps-editor', 'apps-core-demo']
  ],
  ['published Markdown in an internal viewer', ['apps/editor/public/notes.md'], ['tests', 'apps-editor']],
  [
    'static host used by every map application',
    ['platform/tools/serve.py'],
    ['platform', 'apps-web', 'apps-editor', 'apps-core-demo']
  ],
  ['web spec', ['apps/web/tests/e2e/journeys.spec.mjs'], WEB],
  ['shared web source', ['apps/web/src/app.js'], WEB],
  ['stylesheet', ['apps/web/public/style.css'], WEB],
  ['browser test helpers', ['apps/web/tests/e2e/helpers.mjs'], WEB],
  ['web build tool', ['apps/web/tools/build.mjs'], WEB],
  ['new unmapped web source', ['apps/web/src/brand-new.js'], WEB],
  ['web unit test', ['apps/web/tests/core.test.mjs'], WEB],
  ['Markdown in the public web folder', ['apps/web/public/notes.md'], WEB],
  ['platform tooling', ['platform/tools/check-repo.mjs'], ['platform']],
  ['workflow', ['.github/workflows/web.yml'], ['workflows', 'platform']],
  ['composite action', ['.github/actions/setup-web/action.yml'], ['workflows', 'platform']],
  ['Markdown under .github', ['.github/pull_request_template.md'], ['docs']],
  ['the planner itself', ['platform/tools/ci-plan.mjs'], ['workflows', 'platform']],
  ['the workflow test-run helper', ['platform/tools/workflow-test-runs.mjs'], ['workflows', 'platform']],
  ['both sides of a rename', ['docs/old.md', 'services/backend/new.go'], ['docs', 'backend']]
];

for (const [name, files, folders] of cases) {
  test(`plan: ${name}`, () => {
    const plan = planChanges(files);
    assert.deepEqual(new Set(plan.folders), new Set(folders));
  });
}

test('a data-only change selects only data and cross-project tests', () => {
  const plan = planChanges(['data/sources/places.geojson', 'data/artifacts/release.json']);
  assert.deepEqual(new Set(plan.folders), new Set(['data', 'tests']));
});

test('every data path selects its own pipeline and no app or platform pipeline', () => {
  const samples = [
    ['data/sources/source.geojson', ['data', 'tests']],
    ['data/imagery/place.jpg', ['data', 'tests']],
    ['data/artifacts/releases/manifest.json', ['data', 'tests']],
    ['data/tools/app-data.mjs', ['data', 'tests']],
    ['data/Makefile', ['data', 'tests']],
    ['data/package.json', ['data', 'tests']],
    ['data/tests/data.test.mjs', ['data']],
    ['data/tests/fixtures/places.geojson', ['data']]
  ];
  for (const [file, expectedFolders] of samples) {
    const result = planChanges([file]);
    assert.deepEqual(new Set(result.folders), new Set(expectedFolders), file);
  }
});

for (const [name, files] of [
  ['an empty diff', []],
  ['an unknown top-level folder', ['brand-new/file.txt']],
  ['an unknown root file', ['.editorconfig']],
  ['the lockfile', ['package-lock.json']],
  ['the Node version', ['.node-version']],
  ['the lint configuration', ['eslint.config.mjs']],
  ['an unknown file beside known ones', ['docs/README.md', 'brand-new.txt']]
]) {
  test(`plan: ${name} selects everything`, () => {
    const plan = planChanges(files);
    assert.equal(plan.everything, true);
    assert.deepEqual(plan.folders, FOLDERS);
  });
}

test('only the root Makefile narrows the plan; other root files still select everything', () => {
  const rootMakeFolders = [
    'apps-core-demo',
    'apps-editor',
    'apps-web',
    'contracts',
    'data',
    'docs',
    'map-core',
    'platform',
    'tests',
    'transit-relay',
    'workflows'
  ];
  const makefileResult = classify('Makefile');
  assert.deepEqual([...makefileResult.folders].sort(), rootMakeFolders);

  const makefilePlan = planChanges(['Makefile']);
  assert.equal(makefilePlan.everything, false);

  for (const file of ['package.json', 'brand-new.txt']) {
    const otherPlan = planChanges([file]);
    assert.equal(otherPlan.everything, true, file);
    assert.deepEqual(otherPlan.folders, FOLDERS, file);
  }
});

test('the root Makefile folders match the workflows that call root make', () => {
  const workflowsDirectory = path.join(repoRoot, '.github/workflows');
  const callingFolders = fs.readdirSync(workflowsDirectory).flatMap(file => {
    const folder = /^ci-(.+)\.yml$/.exec(file)?.[1];
    if (!folder) return [];
    const workflow = fs.readFileSync(path.join(workflowsDirectory, file), 'utf8');
    const callsRootMake = /^[ \t]*command:[ \t]*make[ \t]+(?:verify[ \t]+PKG=\S+|check-docs)[ \t]*$/m.test(workflow);
    return callsRootMake ? [folder] : [];
  });
  // The lint-workflows and act test targets live in the root Makefile too, but no ci-workflows step calls it.
  const expectedFolders = ['workflows', ...callingFolders].sort();
  assert.deepEqual([...classify('Makefile').folders].sort(), expectedFolders);
});

test('outputs give every folder a value and the selected test runs', () => {
  const changedFiles = ['apps/web/src/interface.js', '.github/workflows/cd-map-core.yml'];
  const lines = formatOutputs(planChanges(changedFiles), changedFiles).split('\n');
  assert.equal(lines.length, FOLDERS.length + 6);
  assert.ok(lines.includes('apps-web=true'));
  assert.ok(lines.includes('docs=false'));
  assert.ok(lines.includes('cd_test_runs=["cd-map-core.yml"]'));
  assert.ok(lines.includes('prove_cd_test_runs=false'));
  assert.ok(lines.includes('ci_in_place_test_runs=[]'));
  assert.ok(lines.includes('ci_test_runs=[]'));
  assert.deepEqual(lines.slice(FOLDERS.length).map(line => line.split('=')[0]), OUTPUT_NAMES);
});

test('a changed folder workflow runs in place, while other changed workflows keep a separate test call', () => {
  const changedFiles = [
    'apps/web/src/interface.js',
    'docs/README.md',
    '.github/workflows/ci-apps-web.yml',
    '.github/workflows/ci-apps-editor.yml',
    '.github/workflows/ci-docs.yml',
    '.github/workflows/ci-publish.yml',
    '.github/workflows/ci-workflows.yml'
  ];
  const lines = formatOutputs(planChanges(changedFiles), changedFiles).split('\n');
  assert.ok(lines.includes('ci_in_place_test_runs=["ci-apps-web.yml","ci-docs.yml","ci-workflows.yml"]'));
  assert.ok(lines.includes('ci_test_runs=["ci-apps-editor.yml","ci-publish.yml"]'));
});

test('a web workflow change needs no planner matrix for its in-place call', () => {
  const workflow = 'ci-apps-web.yml';
  const source = 'apps/web/tests/offline.test.mjs';
  const changedFiles = [`.github/workflows/${workflow}`, source];
  const lines = formatOutputs(planChanges(changedFiles), changedFiles).split('\n');
  assert.ok(lines.includes(`ci_in_place_test_runs=["${workflow}"]`), 'the web call is not in place');
  assert.deepEqual(lines.slice(FOLDERS.length).map(line => line.split('=')[0]), OUTPUT_NAMES);
});

test('an in-place workflows call with no CD changes still proves its dispatcher', () => {
  const changedFiles = ['.github/workflows/ci-workflows.yml'];
  const lines = formatOutputs(planChanges(changedFiles), changedFiles).split('\n');
  assert.ok(lines.includes('ci_in_place_test_runs=["ci-workflows.yml"]'));
  assert.ok(lines.includes('cd_test_runs=[]'));
  assert.ok(lines.includes('prove_cd_test_runs=true'));

  const regularFiles = ['.github/workflows/cd-map-core.yml'];
  const regularLines = formatOutputs(planChanges(regularFiles), regularFiles).split('\n');
  assert.ok(regularLines.includes('cd_test_runs=["cd-map-core.yml"]'));
  assert.ok(regularLines.includes('prove_cd_test_runs=false'));
});

test('summary splits CI test-run calls and shows the CD proof flag', () => {
  const changedFiles = ['.github/workflows/ci-publish.yml', '.github/workflows/ci-workflows.yml'];
  assert.equal(
    formatSummary(planChanges(changedFiles), '', changedFiles),
    [
      'Selected a subset of pipelines.',
      '- Folders: workflows, platform',
      '- CI test-run calls (separate): ci-publish.yml',
      '- CI test runs in place: ci-workflows.yml',
      '- CD proof flag: true',
      '- CD test-run dispatches: none',
      '- Manual test runs: none'
    ].join('\n')
  );

  const regularFiles = ['.github/workflows/ci-publish.yml', '.github/workflows/cd-map-core.yml'];
  const regularSummary = formatSummary(planChanges(regularFiles), '', regularFiles);
  assert.match(regularSummary, /- CI test-run calls \(separate\): ci-publish\.yml/);
  assert.match(regularSummary, /- CI test runs in place: none/);
  assert.match(regularSummary, /- CD test-run dispatches: cd-map-core\.yml/);
  assert.doesNotMatch(regularSummary, /CD proof flag/);
});

test('command line selects everything when it has no base or the diff fails', () => {
  for (const args of [
    ['--all'],
    [],
    ['--base', '0000000000000000000000000000000000000000'],
    ['--base', 'no-such-ref']
  ]) {
    const result = spawnSync('node', ['platform/tools/ci-plan.mjs', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: plannerEnv
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected everything/, `${args.join(' ')}: ${result.stdout}`);
  }
});

test('every verified component has a folder rule', () => {
  const samplesByComponent = {
    'apps/web': 'apps/web/tools/build.mjs',
    'packages/map-core': 'packages/map-core/src/index.js',
    'apps/core-demo': 'apps/core-demo/src/app.js',
    'apps/editor': 'apps/editor/src/app.js',
    data: 'data/tools/pack.py',
    'packages/contracts': 'packages/contracts/fixtures/x.json',
    'services/backend': 'services/backend/internal/x.go',
    'services/transit-relay': 'services/transit-relay/relay.mjs',
    platform: 'platform/tools/verify.mjs',
    tests: 'tests/integration/x.test.mjs',
    docs: 'docs/README.md'
  };
  assert.deepEqual(
    Object.keys(samplesByComponent).sort(),
    Object.keys(plans).sort(),
    'add a sample and a planner rule for the new component'
  );
  for (const [component, file] of Object.entries(samplesByComponent)) {
    assert.notEqual(classify(file).folders.length, FOLDERS.length, `${component} has no folder rule of its own`);
  }
});

test('the browser image has its own pipeline, and a change to it selects no application', () => {
  assert.deepEqual(classify('platform/browser-image/Dockerfile'), {folders: ['browser-image', 'platform']});
});

test('a merge publishes the image of each app it selected, and no other', () => {
  const appsFor = file => imageMatrix(planChanges([file]).folders).include.map(({app}) => app);
  assert.deepEqual(appsFor('apps/web/src/interface.js'), ['web']);
  assert.deepEqual(appsFor('apps/editor/src/sw.js'), ['editor']);
  assert.deepEqual(appsFor('packages/map-core/src/map.js'), ['core-demo'], 'only core-demo runs unreleased core');
  assert.deepEqual(appsFor('packages/contracts/place-visibility.json'), [], 'consumers pin a published release');
  assert.deepEqual(appsFor('docs/README.md'), []);
});

test('Markdown never selects code checks, wherever it lives, while Go stays independent of the web', () => {
  for (const file of [
    'README.md',
    'AGENTS.md',
    '.github/new.md',
    'services/backend/README.md',
    'services/backend/nested/new.md',
    'apps/web/README.md',
    'data/PROVENANCE.md',
    'docs/plans/x.md'
  ]) {
    assert.deepEqual(planChanges([file]), {folders: ['docs'], everything: false}, file);
  }
  assert.deepEqual(planChanges(['services/backend/cmd/server/main.go']), {
    folders: ['backend'],
    everything: false
  });
});

// Folder pipelines replace `make check` in CI, so nothing it runs may fall between them.
test('make check runs every project, and every project has a pipeline that verifies it', () => {
  const pipelineByProject = {
    'packages/map-core': 'map-core',
    'apps/web': 'apps-web',
    'apps/editor': 'apps-editor',
    'apps/core-demo': 'apps-core-demo',
    data: 'data',
    'packages/contracts': 'contracts',
    'services/transit-relay': 'transit-relay',
    platform: 'platform',
    tests: 'tests'
  };
  // What each project's verify must keep running, so no check can quietly drop out of make check and CI.
  const requiredChecks = {
    'packages/map-core': ['lint', 'test'],
    'apps/web': ['lint', 'build', 'test-built', 'offline-check'],
    'apps/editor': ['lint', 'build', 'test'],
    'apps/core-demo': ['lint', 'build', 'test'],
    data: ['lint', 'check', 'test', 'python-test', 'python-check', 'check-topology'],
    'packages/contracts': ['lint', 'test'],
    'services/transit-relay': ['lint', 'test'],
    platform: ['lint', 'markdown-check', 'repo', 'agents-check', 'build-web', 'test', 'python-test', 'python-check'],
    tests: ['lint', 'build-web', 'integration-test']
  };
  const rootMakefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  const projects = rootMakefile.match(/^PROJECTS := (.+)$/m)[1].split(' ');
  assert.deepEqual([...projects].sort(), Object.keys(pipelineByProject).sort());
  assert.match(rootMakefile, /-C \$\$project verify/);
  for (const project of projects) {
    const makefile = fs.readFileSync(path.join(repoRoot, project, 'Makefile'), 'utf8');
    const checks = makefile.match(/^verify: (.+)$/m)[1].split(' ');
    assert.deepEqual(checks, requiredChecks[project], `${project} verify changed: update this table only on purpose`);
    const workflowFile = `.github/workflows/ci-${pipelineByProject[project]}.yml`;
    const workflow = fs.readFileSync(path.join(repoRoot, workflowFile), 'utf8');
    assert.ok(workflow.includes(`make verify PKG=${project}\n`), `${workflowFile} must verify ${project}`);
  }
});

test('a real diff counts both sides of a rename, and deleted files', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-plan-'));
  t.after(() => fs.rmSync(repo, {recursive: true, force: true}));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
      cwd: repo,
      encoding: 'utf8'
    });
  const planner = path.join(repoRoot, 'platform/tools/ci-plan.mjs');
  fs.mkdirSync(path.join(repo, 'data/tools'), {recursive: true});
  fs.mkdirSync(path.join(repo, 'tests'));
  fs.writeFileSync(path.join(repo, 'data/tools/moved.mjs'), 'export const moved = true;\n');
  fs.writeFileSync(path.join(repo, 'tests/deleted.mjs'), 'export const deleted = true;\n');
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
  fs.mkdirSync(path.join(repo, 'services/transit-relay'), {recursive: true});
  fs.renameSync(path.join(repo, 'data/tools/moved.mjs'), path.join(repo, 'services/transit-relay/moved.mjs'));
  git('add', '.');
  git('commit', '-qm', 'rename');
  const renamed = execFileSync('node', [planner, '--base', 'HEAD~1'], {cwd: repo, encoding: 'utf8', env: plannerEnv});
  assert.match(renamed, /Folders: data, transit-relay/);
  fs.rmSync(path.join(repo, 'services/transit-relay/moved.mjs'));
  fs.rmSync(path.join(repo, 'tests/deleted.mjs'));
  git('add', '.');
  git('commit', '-qm', 'delete');
  const deleted = execFileSync('node', [planner, '--base', 'HEAD~1'], {cwd: repo, encoding: 'utf8', env: plannerEnv});
  assert.match(deleted, /Folders: transit-relay, tests/);

  fs.mkdirSync(path.join(repo, 'apps/web/src'), {recursive: true});
  fs.writeFileSync(path.join(repo, 'apps/web/src/interface.js'), 'export const ui = true;\n');
  git('add', '.');
  git('commit', '-qm', 'web');
  const narrowed = execFileSync('node', [planner, '--base', 'HEAD~1'], {cwd: repo, encoding: 'utf8', env: plannerEnv});
  assert.match(narrowed, /Folders: tests, apps-web\n/);
});

test('each browser project checks only itself, and only the public app reaches the deployment', () => {
  const webMakefile = fs.readFileSync(path.join(repoRoot, 'apps/web/Makefile'), 'utf8');
  assert.doesNotMatch(webMakefile, /apps\/editor|apps\/core-demo|packages\/map-core/);
  for (const project of ['apps/web', 'apps/editor', 'apps/core-demo']) {
    const packageFile = JSON.parse(fs.readFileSync(path.join(repoRoot, project, 'package.json')));
    assert.match(packageFile.scripts['pretest:e2e'], /npm run build$/, project);
    assert.match(packageFile.scripts['pretest:e2e'], /MAP_DATA_ROOT=.*pinned-data\.mjs/, project);
    assert.equal(packageFile.scripts['pretest:e2e:built'], undefined, project);
  }
  const editorWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-apps-editor.yml'), 'utf8');
  const webWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-apps-web.yml'), 'utf8');
  assert.doesNotMatch(editorWorkflow, /WEB_ARTIFACT|dist\/web/);
  assert.doesNotMatch(webWorkflow, /dist\/editor|dist\/core-demo/);
});

test('outputs: an empty CD selection is the exact [] the dispatcher compares', () => {
  const lines = formatOutputs(planChanges([]), []).split('\n');
  assert.ok(lines.includes('cd_test_runs=[]'));
  assert.ok(lines.includes('ci_in_place_test_runs=[]'));
  assert.ok(lines.includes('ci_test_runs=[]'));
});
