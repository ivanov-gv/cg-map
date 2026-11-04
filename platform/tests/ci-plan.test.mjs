import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync, spawnSync} from 'node:child_process';
import {BROWSER_AREAS, FOLDERS, SHARED_WEB_SOURCES, browserMatrix, classify, formatOutputs, planChanges} from '../tools/ci-plan.mjs';
import {plans} from '../tools/verify.mjs';
import {repoRoot} from '../agents/lib.mjs';

const ALL_AREAS = Object.keys(BROWSER_AREAS);
const WEB = ['platform', 'tests', 'apps-web'];

const cases = [
  ['docs only', ['docs/runbooks/release.md'], ['docs'], []],
  ['Markdown inside a component', ['apps/web/README.md', 'services/backend/README.md'], ['docs'], []],
  ['root instructions, which a platform test reads', ['AGENTS.md'], ['docs', 'platform'], []],
  ['generated agent rules', ['.claude/rules/go.md'], ['docs'], []],
  ['Markdown configuration', ['.markdownlint.jsonc'], ['docs'], []],
  ['Go code', ['services/backend/cmd/server/main.go'], ['backend'], []],
  ['go.mod', ['services/backend/go.mod'], ['backend'], []],
  ['Go and docs together', ['services/backend/go.sum', 'docs/README.md'], ['docs', 'backend'], []],
  ['backend Makefile', ['services/backend/Makefile'], ['platform', 'backend'], []],
  ['transit relay', ['services/transit-relay/relay.mjs'], ['transit-relay', 'tests'], []],
  ['integration tests', ['tests/integration/archive.test.mjs'], ['tests'], []],
  ['data tools', ['data/tools/pack.py'], ['data'], []],
  ['data sources', ['data/sources/places.geojson'], ['platform', 'data', 'tests', 'apps-web'], ALL_AREAS],
  ['released artifact', ['data/artifacts/release.json'], ['platform', 'data', 'tests', 'apps-web'], ALL_AREAS],
  ['contracts', ['packages/contracts/places.schema.json'], ['platform', 'contracts', 'data', 'backend', 'tests', 'apps-web'], ALL_AREAS],
  ['mapped web source', ['apps/web/src/interface.js'], WEB, ['interface']],
  ['POI source runs both projects', ['apps/web/src/poi-icons.js'], WEB, ['poi-desktop', 'poi-mobile']],
  ['spec runs its own area', ['apps/web/tests/e2e/journeys.spec.mjs'], WEB, ['journeys']],
  ['shared web source', ['apps/web/src/app.js'], WEB, ALL_AREAS],
  ['stylesheet', ['apps/web/public/style.css'], WEB, ALL_AREAS],
  ['browser test helpers', ['apps/web/tests/e2e/helpers.mjs'], WEB, ALL_AREAS],
  ['web build tool', ['apps/web/tools/build.mjs'], WEB, ALL_AREAS],
  ['new unmapped web source', ['apps/web/src/brand-new.js'], WEB, ALL_AREAS],
  ['web unit test', ['apps/web/tests/core.test.mjs'], WEB, []],
  ['Markdown in the public web folder', ['apps/web/public/notes.md'], WEB, ALL_AREAS],
  ['pages compatibility entry', ['platform/pages/legacy-sw.js'], ['platform', 'apps-web'], ALL_AREAS],
  ['test server', ['platform/tools/serve.py'], ['platform', 'apps-web'], ALL_AREAS],
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
  assert.equal(lines.length, FOLDERS.length + 1);
  assert.ok(lines.includes('apps-web=true'));
  assert.ok(lines.includes('docs=false'));
  const matrixLine = lines.find(line => line.startsWith('browser_matrix='));
  assert.deepEqual(JSON.parse(matrixLine.slice('browser_matrix='.length)), {
    include: [{area: 'interface', specs: BROWSER_AREAS.interface.specs}]
  });
});

test('command line selects everything when it has no base or the diff fails', () => {
  for (const args of [['--all'], [], ['--base', '0000000000000000000000000000000000000000'], ['--base', 'no-such-ref']]) {
    const result = spawnSync('node', ['platform/tools/ci-plan.mjs', ...args], {cwd: repoRoot, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Selected everything/, `${args.join(' ')}: ${result.stdout}`);
  }
});

test('every verified component has a folder rule', () => {
  const samplesByComponent = {
    'apps/web': 'apps/web/tools/build.mjs',
    data: 'data/tools/pack.py',
    'packages/contracts': 'packages/contracts/fixtures/x.json',
    'services/backend': 'services/backend/internal/x.go',
    'services/transit-relay': 'services/transit-relay/relay.mjs',
    platform: 'platform/tools/verify.mjs',
    tests: 'tests/integration/x.test.mjs',
    docs: 'docs/README.md'
  };
  assert.deepEqual(Object.keys(samplesByComponent).sort(), Object.keys(plans).sort(), 'add a sample and a planner rule for the new component');
  for (const [component, file] of Object.entries(samplesByComponent)) {
    assert.notEqual(classify(file).folders.length, FOLDERS.length, `${component} has no folder rule of its own`);
  }
});

test('every web source is mapped to an area or shared, and listed only once', () => {
  const mapped = Object.values(BROWSER_AREAS).flatMap(area => area.sources);
  const sources = fs.readdirSync(path.join(repoRoot, 'apps/web/src'));
  for (const source of sources) {
    assert.ok(mapped.includes(source) || SHARED_WEB_SOURCES.includes(source), `apps/web/src/${source} needs an area or a shared entry`);
    assert.equal(mapped.includes(source) && SHARED_WEB_SOURCES.includes(source), false, `${source} is both mapped and shared`);
  }
  for (const source of [...mapped, ...SHARED_WEB_SOURCES]) assert.ok(sources.includes(source), `${source} no longer exists`);
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
  for (const project of projects) assert.ok(config.includes(`name: '${project}'`), `${project} is not a browser project`);
  const areas = Object.values(BROWSER_AREAS);
  for (const area of areas.filter(({specs}) => specs.includes('--project='))) {
    const partners = areas.filter(({specFiles}) => specFiles[0] === area.specFiles[0]);
    for (const project of projects) {
      assert.ok(partners.some(({specs}) => specs.includes(`--project=${project}`)), `${area.specFiles[0]} does not run on ${project}`);
    }
  }
});

test('the browser matrix contains exactly the requested areas', () => {
  assert.deepEqual(browserMatrix([]), {include: []});
  assert.deepEqual(browserMatrix(ALL_AREAS).include.map(({area}) => area), ALL_AREAS);
});

// Folder pipelines replace `make check` in CI, so nothing it runs may fall between them.
test('folder checks together cover everything make check runs', () => {
  // Each command make check runs, the Makefile that owns it, and what that Makefile runs for it.
  const owners = {
    'npm run lint:md': ['platform/Makefile', 'npm run -s lint:md'],
    'npm run lint --workspace @cg-map/web': ['apps/web/Makefile', 'npm run lint'],
    'eslint data/tools': ['data/Makefile', 'eslint data/tools'],
    'eslint data/tests': ['data/Makefile', 'data/tests'],
    'eslint platform': ['platform/Makefile', 'eslint platform'],
    'eslint tests': ['tests/Makefile', 'eslint tests'],
    'eslint eslint.config.mjs': ['platform/Makefile', 'eslint.config.mjs'],
    'eslint services/transit-relay/*.mjs': ['services/transit-relay/Makefile', 'eslint services/transit-relay/*.mjs'],
    'eslint services/transit-relay/tests/*.mjs': ['services/transit-relay/Makefile', 'services/transit-relay/tests/*.mjs'],
    'npm run check:data': ['data/Makefile', 'npm run -s check:data'],
    'npm run check:repo': ['platform/Makefile', 'npm run -s check:repo'],
    'npm run check:agents': ['platform/Makefile', 'npm run -s check:agents'],
    'npm run build:web': ['platform/Makefile', 'npm run -s build:web'],
    'npm run test:built --workspace @cg-map/web': ['apps/web/Makefile', 'npm run test:built'],
    'node --test data/tests/*.test.mjs': ['data/Makefile', 'node --test data/tests/*.test.mjs'],
    'node --test platform/tests/*.test.mjs': ['platform/Makefile', 'node --test platform/tests/*.test.mjs'],
    'node --test tests/integration/*.test.mjs': ['tests/Makefile', 'node --test tests/integration/*.test.mjs'],
    'node --test services/transit-relay/tests/*.test.mjs': ['services/transit-relay/Makefile', 'node --test services/transit-relay/tests/*.test.mjs'],
    'python3 -m unittest discover -s platform/tests -p "test_*.py"': ['platform/Makefile', 'unittest discover -s platform/tests'],
    'python3 -m py_compile platform/tools/*.py': ['platform/Makefile', 'py_compile platform/tools/*.py'],
    'python3 -m py_compile data/tools/*.py': ['data/Makefile', 'py_compile data/tools/*.py'],
    'npm run check:offline': ['apps/web/Makefile', 'npm run check:offline'],
    'npm run check:python --workspace @cg-map/web': ['apps/web/Makefile', 'npm run check:python']
  };
  const {scripts} = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const multiTargetTool = /^(eslint|node --test|python3 -m py_compile) (.+)$/;
  const expand = command => command.split(' && ').flatMap(part => {
    if (part === 'npm run lint') return expand(scripts.lint);
    if (part === 'npm test') return expand(scripts.test);
    const multiTarget = part.match(multiTargetTool);
    return multiTarget ? multiTarget[2].split(' ').map(target => `${multiTarget[1]} ${target}`) : [part];
  });
  for (const command of expand(scripts.check)) {
    assert.ok(owners[command], `make check runs "${command}", so add it to a folder's Makefile and to this table`);
  }
  for (const [command, [makefile, text]] of Object.entries(owners)) {
    assert.ok(fs.readFileSync(path.join(repoRoot, makefile), 'utf8').includes(text), `${makefile} must run "${command}"`);
  }
});

test('a real diff counts both sides of a rename, and deleted files', t => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-plan-'));
  t.after(() => fs.rmSync(repo, {recursive: true, force: true}));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {cwd: repo, encoding: 'utf8'});
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
  const renamed = execFileSync('node', [planner, '--base', 'HEAD~1'], {cwd: repo, encoding: 'utf8'});
  assert.match(renamed, /Folders: data, transit-relay, tests/);
  fs.rmSync(path.join(repo, 'services/transit-relay/moved.mjs'));
  fs.rmSync(path.join(repo, 'tests/deleted.mjs'));
  git('add', '.');
  git('commit', '-qm', 'delete');
  const deleted = execFileSync('node', [planner, '--base', 'HEAD~1'], {cwd: repo, encoding: 'utf8'});
  assert.match(deleted, /Folders: transit-relay, tests/);
});
