import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {componentFor, plans} from '../tools/verify.mjs';
import {repoRoot} from '../agents/lib.mjs';

const components = ['apps/web', 'data', 'packages/contracts', 'services/backend', 'services/transit-relay', 'platform', 'tests'];

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
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/backend.yml'), 'utf8');
  assert.doesNotMatch(backendMakefile, /\b(?:node|npm|npx)\b/);
  assert.match(workflow, /make -C services\/backend check/);
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