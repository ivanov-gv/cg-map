import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {
  BROWSER_AREAS,
  FOLDERS,
  SHARED_WEB_SOURCES,
  browserMatrix,
  classify,
  formatOutputs,
  planChanges,
  imageMatrix
} from '../tools/ci-plan.mjs';
import {plans} from '../tools/verify.mjs';
import {repoRoot} from '../agents/lib.mjs';

// Inside CI these would send the test's own plans to the real job's output and summary.
const plannerEnv = {...process.env};
delete plannerEnv.GITHUB_OUTPUT;
delete plannerEnv.GITHUB_STEP_SUMMARY;
const ALL_AREAS = Object.keys(BROWSER_AREAS);
const WEB = ['platform', 'tests', 'apps-web'];
const MAP_CONTRACT_DEPENDENTS = ['tests', 'map-core', 'apps-web', 'apps-editor', 'apps-core-demo'];

const cases = [
  ['docs only', ['docs/runbooks/release.md'], ['docs'], []],
  ['Markdown inside a component', ['apps/web/README.md', 'services/backend/README.md'], ['docs'], []],
  ['root instructions, whose assertions run with the docs', ['AGENTS.md'], ['docs'], []],
  ['generated agent rules', ['.claude/rules/go.md'], ['docs'], []],
  ['Markdown configuration', ['.markdownlint.jsonc'], ['docs'], []],
  ['Go code', ['services/backend/cmd/server/main.go'], ['backend'], []],
  ['go.mod', ['services/backend/go.mod'], ['backend'], []],
  ['Go and docs together', ['services/backend/go.sum', 'docs/README.md'], ['docs', 'backend'], []],
  ['backend Makefile', ['services/backend/Makefile'], ['platform', 'backend'], []],
  ['transit relay', ['services/transit-relay/relay.mjs'], ['transit-relay'], []],
  ['integration tests', ['tests/integration/archive.test.mjs'], ['tests'], []],
  ['data tools', ['data/tools/pack.py'], ['data'], []],
  ['data sources', ['data/sources/places.geojson'], ['platform', 'data', ...MAP_CONTRACT_DEPENDENTS], ALL_AREAS],
  ['released artifact', ['data/artifacts/release.json'], ['platform', 'data', ...MAP_CONTRACT_DEPENDENTS], ALL_AREAS],
  [
    'contracts',
    ['packages/contracts/places.schema.json'],
    ['platform', 'contracts', 'data', 'backend', ...MAP_CONTRACT_DEPENDENTS],
    ALL_AREAS
  ],
  ['mapped web source', ['apps/web/src/interface.js'], WEB, ['interface']],
  ['POI spec runs both projects', ['apps/web/tests/e2e/poi-visibility.spec.mjs'], WEB, ['poi-desktop', 'poi-mobile']],
  [
    'shared map runtime',
    ['packages/map-core/src/poi-icons.js'],
    ['platform', 'map-core', 'apps-core-demo'],
    []
  ],
  [
    'shared map build helpers',
    ['packages/map-core/tools/assemble.mjs'],
    ['platform', 'map-core', 'apps-core-demo'],
    []
  ],
  ['source viewer alone', ['apps/editor/src/app.js'], ['tests', 'apps-editor'], []],
  ['source viewer Makefile', ['apps/editor/Makefile'], ['platform', 'tests', 'apps-editor'], []],
  ['concept app alone', ['apps/core-demo/src/app.js'], ['apps-core-demo'], []],
  ['concept app package', ['apps/core-demo/package.json'], ['platform', 'apps-core-demo'], []],
  ['source bundle producer', ['data/tools/editor-bundle.mjs'], ['data', 'tests', 'apps-editor'], []],
  ['changeset importer', ['data/tools/apply-changeset.mjs'], ['data', 'tests'], []],
  ['LAN certificate tool', ['platform/tools/lan_certificate.py'], ['platform', 'apps-editor'], []],
  ['data check behind the importer', ['data/tools/check-data.mjs'], ['data', 'tests'], []],
  ['level policy behind the importer', ['data/tools/apply-place-visibility.mjs'], ['data', 'tests'], []],
  [
    'web test fixture in data',
    ['data/tests/fixtures/podgorica-places.geojson'],
    ['data', 'platform', 'tests', 'apps-web'],
    ALL_AREAS
  ],
  [
    'preview port tool used by every map application',
    ['platform/tools/dev-port.mjs'],
    ['platform', 'apps-web', 'apps-editor', 'apps-core-demo'],
    ALL_AREAS
  ],
  ['published Markdown in an internal viewer', ['apps/editor/public/notes.md'], ['tests', 'apps-editor'], []],
  [
    'static host used by every map application',
    ['platform/tools/serve.py'],
    ['platform', 'apps-web', 'apps-editor', 'apps-core-demo'],
    ALL_AREAS
  ],
  ['spec runs its own area', ['apps/web/tests/e2e/journeys.spec.mjs'], WEB, ['journeys']],
  ['shared web source', ['apps/web/src/app.js'], WEB, ALL_AREAS],
  ['stylesheet', ['apps/web/public/style.css'], WEB, ALL_AREAS],
  ['browser test helpers', ['apps/web/tests/e2e/helpers.mjs'], WEB, ALL_AREAS],
  ['web build tool', ['apps/web/tools/build.mjs'], WEB, ALL_AREAS],
  ['new unmapped web source', ['apps/web/src/brand-new.js'], WEB, ALL_AREAS],
  ['web unit test', ['apps/web/tests/core.test.mjs'], WEB, []],
  ['Markdown in the public web folder', ['apps/web/public/notes.md'], WEB, ALL_AREAS],
  ['platform tooling', ['platform/tools/check-repo.mjs'], ['platform'], []],
  ['workflow', ['.github/workflows/web.yml'], ['workflows', 'platform'], []],
  ['composite action', ['.github/actions/setup-web/action.yml'], ['workflows', 'platform'], []],
  ['Markdown under .github', ['.github/pull_request_template.md'], ['docs'], []],
  ['the planner itself', ['platform/tools/ci-plan.mjs'], ['workflows', 'platform'], []],
  ['both sides of a rename', ['docs/old.md', 'services/backend/new.go'], ['docs', 'backend'], []]
];

for (const [name, files, folders, areas] of cases) {
  test(`plan: ${name}`, () => {
    const plan = planChanges(files);
    assert.deepEqual(new Set(plan.folders), new Set(folders));
    assert.deepEqual(new Set(plan.areas), new Set(areas));
  });
}

for (const [name, files] of [
  ['an empty diff', []],
  ['an unknown top-level folder', ['brand-new/file.txt']],
  ['an unknown root file', ['.editorconfig']],
  ['the lockfile', ['package-lock.json']],
  ['the root Makefile', ['Makefile']],
  ['the Node version', ['.node-version']],
  ['the lint configuration', ['eslint.config.mjs']],
  ['an unknown file beside known ones', ['docs/README.md', 'brand-new.txt']]
]) {
  test(`plan: ${name} selects everything`, () => {
    const plan = planChanges(files);
    assert.equal(plan.everything, true);
    assert.deepEqual(plan.folders, FOLDERS);
    assert.deepEqual(plan.areas, ALL_AREAS);
  });
}

test('outputs give every folder a value and a usable matrix', () => {
  const lines = formatOutputs(planChanges(['apps/web/src/interface.js'])).split('\n');
  assert.equal(lines.length, FOLDERS.length + 2);
  assert.ok(lines.includes('apps-web=true'));
  assert.ok(lines.includes('docs=false'));
  const matrixLine = lines.find(line => line.startsWith('browser_matrix='));
  assert.deepEqual(JSON.parse(matrixLine.slice('browser_matrix='.length)), {
    include: [{area: 'interface', specs: BROWSER_AREAS.interface.specs}]
  });
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

test('every web source is mapped to an area or shared, and listed only once', () => {
  const mapped = Object.values(BROWSER_AREAS).flatMap(area => area.sources);
  const sources = fs.readdirSync(path.join(repoRoot, 'apps/web/src'));
  for (const source of sources) {
    assert.ok(
      mapped.includes(source) || SHARED_WEB_SOURCES.includes(source),
      `apps/web/src/${source} needs an area or a shared entry`
    );
    assert.equal(
      mapped.includes(source) && SHARED_WEB_SOURCES.includes(source),
      false,
      `${source} is both mapped and shared`
    );
  }
  for (const source of [...mapped, ...SHARED_WEB_SOURCES])
    assert.ok(sources.includes(source), `${source} no longer exists`);
});

test('every spec has an area, and the areas name real specs', () => {
  const specs = fs.readdirSync(path.join(repoRoot, 'apps/web/tests/e2e')).filter(file => file.endsWith('.spec.mjs'));
  const mapped = Object.values(BROWSER_AREAS).flatMap(area => area.specFiles);
  for (const spec of specs) assert.ok(mapped.includes(spec), `${spec} needs a browser area`);
  for (const area of Object.values(BROWSER_AREAS)) {
    for (const spec of area.specFiles) {
      assert.ok(specs.includes(spec), `${spec} no longer exists`);
      assert.ok(area.specs.includes(`tests/e2e/${spec}`), `${spec} is missing from the area's command`);
    }
  }
});

test('an area limited to one project has a partner covering the other', () => {
  const projects = ['root-desktop', 'pages-mobile'];
  const config = fs.readFileSync(path.join(repoRoot, 'apps/web/playwright.config.mjs'), 'utf8');
  for (const project of projects)
    assert.ok(config.includes(`name: '${project}'`), `${project} is not a browser project`);
  const areas = Object.values(BROWSER_AREAS);
  for (const area of areas.filter(({specs}) => specs.includes('--project='))) {
    const partners = areas.filter(({specFiles}) => specFiles[0] === area.specFiles[0]);
    for (const project of projects) {
      assert.ok(
        partners.some(({specs}) => specs.includes(`--project=${project}`)),
        `${area.specFiles[0]} does not run on ${project}`
      );
    }
  }
});

test('an area too slow for one job runs every share of its tests', () => {
  assert.deepEqual(browserMatrix(['journeys']).include, [
    {area: 'journeys-1', specs: 'tests/e2e/journeys.spec.mjs --shard=1/2'},
    {area: 'journeys-2', specs: 'tests/e2e/journeys.spec.mjs --shard=2/2'}
  ]);
  assert.deepEqual(browserMatrix(['interface']).include, [{area: 'interface', specs: 'tests/e2e/interface.spec.mjs'}]);
});

test('a merge publishes the image of each app it selected, and no other', () => {
  const appsFor = file => imageMatrix(planChanges([file]).folders).include.map(({app}) => app);
  assert.deepEqual(appsFor('apps/web/src/interface.js'), ['web']);
  assert.deepEqual(appsFor('apps/editor/src/sw.js'), ['editor']);
  assert.deepEqual(appsFor('packages/map-core/src/map.js'), ['core-demo'], 'only core-demo runs unreleased core');
  assert.deepEqual(appsFor('packages/contracts/place-visibility.json'), ['web', 'editor', 'core-demo']);
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
    assert.deepEqual(planChanges([file]), {folders: ['docs'], areas: [], everything: false}, file);
  }
  assert.deepEqual(planChanges(['services/backend/cmd/server/main.go']), {
    folders: ['backend'],
    areas: [],
    everything: false
  });
});

test('the browser matrix contains exactly the requested areas', () => {
  assert.deepEqual(browserMatrix([]), {include: []});
  // A job of a split area is named after it, such as journeys-1.
  const areaOfEachJob = browserMatrix(ALL_AREAS).include.map(({area}) => area.replace(/-\d+$/, ''));
  assert.deepEqual(new Set(areaOfEachJob), new Set(ALL_AREAS));
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
    data: ['lint', 'check', 'test', 'python-test', 'python-check'],
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
  assert.match(narrowed, /Browser areas: interface\n/);
});

test('each browser project checks only itself, and only the public app reaches the deployment', () => {
  const webMakefile = fs.readFileSync(path.join(repoRoot, 'apps/web/Makefile'), 'utf8');
  assert.doesNotMatch(webMakefile, /apps\/editor|apps\/core-demo|packages\/map-core/);
  for (const project of ['apps/web', 'apps/editor', 'apps/core-demo']) {
    const packageFile = JSON.parse(fs.readFileSync(path.join(repoRoot, project, 'package.json')));
    assert.equal(packageFile.scripts['pretest:e2e'], 'npm run build', project);
    assert.equal(packageFile.scripts['pretest:e2e:built'], undefined, project);
  }
  const editorWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-apps-editor.yml'), 'utf8');
  const webWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-apps-web.yml'), 'utf8');
  assert.doesNotMatch(editorWorkflow, /WEB_ARTIFACT|dist\/web/);
  assert.doesNotMatch(webWorkflow, /dist\/editor|dist\/core-demo/);
});
