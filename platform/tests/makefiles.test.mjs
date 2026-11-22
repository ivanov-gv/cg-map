import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import operatingSystem from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {componentFor, plans} from '../tools/verify.mjs';
import {repoRoot} from '../agents/lib.mjs';

const components = ['packages/map-core', 'apps/core-demo', 'apps/editor', 'apps/web', 'data', 'packages/contracts', 'services/backend', 'services/transit-relay', 'platform', 'tests'];

test('component verification delegates to owner Makefiles', () => {
  for (const component of components) {
    assert.deepEqual(plans[component], [['make', '--no-print-directory', '-C', component, 'verify']]);
    const makefile = fs.readFileSync(path.join(repoRoot, component, 'Makefile'), 'utf8');
    const root = makefile.match(/^ROOT := (.+)$/m)?.[1];
    assert.ok(root, `${component}/Makefile must define its repository root`);
    assert.equal(path.resolve(repoRoot, component, root), repoRoot, `${component}/Makefile must resolve the repository root`);
    assert.match(makefile, /^verify:/m);
  }
  assert.equal(componentFor('services/backend/cmd/server/main.go'), 'services/backend');
  assert.equal(componentFor('docs/system-architecture/ownership.md'), 'docs');
  assert.deepEqual(plans.docs, [['make', '--no-print-directory', '-f', 'platform/docs.mk', 'verify']]);
  assert.ok(fs.existsSync(path.join(repoRoot, 'platform/docs.mk')));
});

test('backend checks stay independent of Node and npm', () => {
  const backendMakefile = fs.readFileSync(path.join(repoRoot, 'services/backend/Makefile'), 'utf8');
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci-backend.yml'), 'utf8');
  assert.doesNotMatch(backendMakefile, /\b(?:node|npm|npx)\b/);
  assert.match(backendMakefile, /^export GOLANGCI_LINT_CACHE \?= .*\/\.build\//m, 'each worktree needs its own lint cache');
  assert.match(workflow, /make -C services\/backend check/);
  assert.doesNotMatch(workflow, /setup-web|setup-node/);
});

test('repo boundary rejects non-Markdown docs files and missing folder entry points', t => {
  const unexpected = path.join(repoRoot, 'docs', `__boundary-probe-${process.pid}.txt`);
  const topic = path.join(repoRoot, 'docs', `__boundary-probe-${process.pid}`);
  t.after(() => fs.rmSync(unexpected, {force: true}));
  t.after(() => fs.rmSync(topic, {force: true, recursive: true}));
  const checkRepo = () => spawnSync('node', ['platform/tools/check-repo.mjs'], {cwd: repoRoot, encoding: 'utf8'});

  const allowed = checkRepo();
  assert.equal(allowed.status, 0, `${allowed.stdout ?? ''}${allowed.stderr ?? ''}`);

  fs.writeFileSync(unexpected, 'not documentation');
  const rejected = checkRepo();
  const output = `${rejected.stdout ?? ''}${rejected.stderr ?? ''}`;
  assert.notEqual(rejected.status, 0, output);
  assert.ok(output.includes(path.basename(unexpected)), output);

  fs.rmSync(unexpected);
  fs.mkdirSync(topic);
  fs.writeFileSync(path.join(topic, 'README.md'), '# Boundary probe\n');
  fs.writeFileSync(path.join(topic, 'AGENTS.md'), '# Boundary probe\n');
  const nested = path.join(topic, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(nested, 'README.md'), '# Nested boundary probe\n');
  fs.writeFileSync(path.join(nested, 'AGENTS.md'), '# Nested boundary probe\n');
  const complete = checkRepo();
  assert.equal(complete.status, 0, `${complete.stdout ?? ''}${complete.stderr ?? ''}`);
  fs.rmSync(path.join(topic, 'AGENTS.md'));
  const missingEntryPoint = checkRepo();
  const missingOutput = `${missingEntryPoint.stdout ?? ''}${missingEntryPoint.stderr ?? ''}`;
  assert.notEqual(missingEntryPoint.status, 0, missingOutput);
  assert.ok(missingOutput.includes(`${path.basename(topic)}/ must contain AGENTS.md`), missingOutput);
  fs.writeFileSync(path.join(topic, 'AGENTS.md'), '# Boundary probe\n');
  fs.rmSync(path.join(nested, 'README.md'));
  const missingReadme = checkRepo();
  const readmeOutput = `${missingReadme.stdout ?? ''}${missingReadme.stderr ?? ''}`;
  assert.notEqual(missingReadme.status, 0, readmeOutput);
  assert.ok(readmeOutput.includes(`${path.basename(topic)}/nested/ must contain README.md`), readmeOutput);
});

test('docs lint rejects malformed docs and ignores Markdown outside docs', t => {
  const suffix = `${process.pid}.md`;
  const inScope = path.join(repoRoot, 'docs', `__docs-lint-probe-${suffix}`);
  const outOfScope = path.join(repoRoot, 'platform/tests', `__docs-lint-probe-${suffix}`);
  const malformed = '# Markdown lint scope probe\n\n```\ncontent\n```\n';
  t.after(() => {
    fs.rmSync(inScope, {force: true});
    fs.rmSync(outOfScope, {force: true});
  });

  fs.writeFileSync(inScope, malformed);
  fs.writeFileSync(outOfScope, malformed);
  const included = spawnSync('make', ['--no-print-directory', '-f', 'platform/docs.mk', 'lint'], {cwd: repoRoot, encoding: 'utf8'});
  const includedOutput = `${included.stdout ?? ''}${included.stderr ?? ''}`;
  assert.notEqual(included.status, 0, includedOutput);
  assert.ok(includedOutput.includes(path.basename(inScope)), includedOutput);

  fs.rmSync(inScope);
  const excluded = spawnSync('make', ['--no-print-directory', '-f', 'platform/docs.mk', 'lint'], {cwd: repoRoot, encoding: 'utf8'});
  assert.equal(excluded.status, 0, `${excluded.stdout ?? ''}${excluded.stderr ?? ''}`);
});

test('repo boundary rejects forbidden imports whose list spans several lines', t => {
  const probe = path.join(repoRoot, 'apps/editor/src', `__boundary-probe-${process.pid}.js`);
  t.after(() => fs.rmSync(probe, {force: true}));
  fs.writeFileSync(probe, "import {\n  categories\n} from '../../web/src/core.js';\n");
  const result = spawnSync('node', ['platform/tools/check-repo.mjs'], {cwd: repoRoot, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden dependency \.\.\/\.\.\/web\/src\/core\.js/);
});

for (const application of ['apps/web', 'apps/editor', 'apps/core-demo']) {
  test(`${application} repo boundary rejects repository data paths in tests`, t => {
    const probe = path.join(repoRoot, application, 'tests', `__data-probe-${process.pid}.mjs`);
    t.after(() => fs.rmSync(probe, {force: true}));
    fs.writeFileSync(probe, "export const source = '../../../../data/sources/places.geojson';\n");
    const result = spawnSync('node', ['platform/tools/check-repo.mjs'], {cwd: repoRoot, encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.ok(output.includes(path.basename(probe)), output);
    assert.match(output, /pinned @ivanov-gv\/map-data package/, output);
  });
}

test('integration repo boundary rejects repository data paths outside the shared helper', t => {
  const probe = path.join(repoRoot, 'tests', `__data-probe-${process.pid}.mjs`);
  t.after(() => fs.rmSync(probe, {force: true}));
  fs.writeFileSync(probe, "export const source = '../../data/sources/places.geojson';\n");
  const result = spawnSync('node', ['platform/tools/check-repo.mjs'], {cwd: repoRoot, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.ok(output.includes(path.basename(probe)), output);
  assert.match(output, /tests\/data-root\.mjs/, output);
});

test('the integration data helper defaults to HEAD and honours MAP_DATA_ROOT', () => {
  const helper = path.join(repoRoot, 'tests', 'data-root.mjs');
  const cleanEnv = {...process.env};
  delete cleanEnv.MAP_DATA_ROOT;
  const head = spawnSync('node', [helper], {cwd: repoRoot, encoding: 'utf8', env: cleanEnv});
  assert.equal(head.status, 0, head.stderr);
  assert.equal(head.stdout.trim(), path.join(repoRoot, 'data'));
  const overrideRoot = path.join(repoRoot, 'tests', 'release-root-probe');
  const override = spawnSync('node', [helper], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {...cleanEnv, MAP_DATA_ROOT: overrideRoot}
  });
  assert.equal(override.status, 0, override.stderr);
  assert.equal(override.stdout.trim(), overrideRoot);
  const empty = spawnSync('node', [helper], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {...cleanEnv, MAP_DATA_ROOT: ''}
  });
  assert.notEqual(empty.status, 0);
  assert.match(empty.stderr, /MAP_DATA_ROOT is set but empty/);
});

test('the published data root resolves an installed package and rejects repository data', t => {
  const fixtureRoot = fs.mkdtempSync(path.join(operatingSystem.tmpdir(), 'cg-map-published-data-'));
  t.after(() => fs.rmSync(fixtureRoot, {recursive: true, force: true}));
  const fixtureTests = path.join(fixtureRoot, 'tests');
  const fixtureData = path.join(fixtureRoot, 'data');
  const fixturePackage = path.join(fixtureTests, 'node_modules', '@ivanov-gv', 'map-data');
  fs.mkdirSync(fixturePackage, {recursive: true});
  fs.mkdirSync(fixtureData, {recursive: true});
  fs.copyFileSync(path.join(repoRoot, 'tests', 'data-root.mjs'), path.join(fixtureTests, 'data-root.mjs'));
  const packageIdentity = '{"name":"@ivanov-gv/map-data","version":"9.9.9"}\n';
  fs.writeFileSync(path.join(fixturePackage, 'package.json'), packageIdentity);
  fs.writeFileSync(path.join(fixtureData, 'package.json'), packageIdentity);
  const helper = path.join(fixtureTests, 'data-root.mjs');
  const published = spawnSync('node', [helper, '--published'], {cwd: repoRoot, encoding: 'utf8'});
  assert.equal(published.status, 0, published.stderr);
  assert.equal(published.stdout.trim(), fixturePackage);

  fs.rmSync(fixturePackage, {recursive: true});
  fs.symlinkSync(fixtureData, fixturePackage, 'dir');
  const repositoryData = spawnSync('node', [helper, '--published'], {cwd: repoRoot, encoding: 'utf8'});
  assert.notEqual(repositoryData.status, 0);
  assert.match(repositoryData.stderr, /must resolve an installed @ivanov-gv\/map-data package, not repository data/);
});

test('repo boundary rejects path builders that target repository data', t => {
  const probe = path.join(repoRoot, 'apps/web/tests', `__data-join-probe-${process.pid}.mjs`);
  t.after(() => fs.rmSync(probe, {force: true}));
  fs.writeFileSync(probe, "export const source = path.join(repositoryRoot, 'data', 'sources', 'places.geojson');\n");
  const result = spawnSync('node', ['platform/tools/check-repo.mjs'], {cwd: repoRoot, encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.ok(output.includes(path.basename(probe)), output);
  assert.match(output, /pinned @ivanov-gv\/map-data package/, output);
});

test('each application owns its build and run targets, and the root Makefile has neither', () => {
  const rootMakefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  const rootTargets = [...rootMakefile.matchAll(/^([a-z][\w-]*)\s*:(?!=)/gm)].map(match => match[1]);
  for (const applicationTarget of ['build', 'build-web', 'build-data', 'dev', 'dev-mock', 'dev-editor', 'dev-core-demo', 'pages']) {
    assert.ok(!rootTargets.includes(applicationTarget), `root Makefile must not define ${applicationTarget}`);
  }
  assert.doesNotMatch(rootMakefile, /-C \S+ (?:build|dev)\b|npm run -?s? ?build|serve\.py/);
  const rootScripts = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'))).scripts;
  assert.deepEqual(Object.keys(rootScripts).sort(), ['check:agents', 'check:repo', 'format:md', 'lint:md', 'setup']);
  for (const application of ['apps/web', 'apps/editor', 'apps/core-demo']) {
    const makefile = fs.readFileSync(path.join(repoRoot, application, 'Makefile'), 'utf8');
    for (const target of ['build', 'dev', 'lint', 'test', 'verify', 'e2e', 'e2e-built']) {
      assert.match(makefile, new RegExp(`^${target}:`, 'm'), `${application} needs a ${target} target`);
    }
  }
});

test("platform's build-web builds the web artifact from its own map-data pin", () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'platform/Makefile'), 'utf8');
  assert.match(makefile, /MAP_DATA_ROOT=.*tools\/pinned-data-root\.mjs/);
  assert.doesNotMatch(makefile, /apps\/web\/node_modules/);
});

test('project Makefiles reach other projects only through listed contracts', () => {
  const allowedReaches = {
    'apps/web': ['platform/tools/dev-port.mjs', 'services/backend'],
    'apps/editor': ['platform/tools/dev-port.mjs', 'platform/tools/serve.py', 'platform/tools/lan_certificate.py'],
    'apps/core-demo': ['platform/tools/dev-port.mjs', 'platform/tools/serve.py'],
    'services/backend': ['packages/contracts/proto'],
    platform: ['apps/web'],
    tests: ['apps/web']
  };
  for (const component of components) {
    const makefile = fs.readFileSync(path.join(repoRoot, component, 'Makefile'), 'utf8');
    const reaches = [...makefile.matchAll(/\$\(ROOT\)\/((?:apps|packages|services|platform|data|tests)[^\s;)]*)/g)].map(match => match[1]);
    const unlisted = reaches.filter(reach => !reach.startsWith(component) && !(allowedReaches[component] ?? []).includes(reach));
    assert.deepEqual(unlisted, [], `${component}/Makefile reaches another project without a listed contract`);
  }
});

test('every local workflow run uses the published image', () => {
  const makefile = fs.readFileSync(path.join(repoRoot, 'Makefile'), 'utf8');
  assert.match(makefile, /-P ubuntu-24\.04=\$\(ACT_IMAGE\) -P ubuntu-latest=\$\(ACT_IMAGE\)/);
  assert.match(makefile, /^test-ci-pr-checks .*: test-%: act-image$/m);
  assert.match(makefile, /^test-cd-map-core: act-image$/m);
  assert.match(makefile, /^test-cd-map-data: act-image$/m);
  assert.match(makefile, /--var BROWSER_CONTAINER_OPTIONS="--device \/dev\/dri"/, 'a job container needs the GPU passed itself');
  assert.match(makefile, /^test-cd-browser-image: act-image$/m);
});

test('test-all-workflows dry run does not require COMMIT', () => {
  // Targets that need COMMIT must allow dry run without it, using the pattern from test-cd-map-core.
  const result = spawnSync('make', ['-n', 'test-all-workflows', 'ACT=gh act -n'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {...process.env, COMMIT: ''}
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `dry run must not fail for missing COMMIT: ${output}`);
  assert.doesNotMatch(output, /Set COMMIT/, 'dry run must not require COMMIT');
});
