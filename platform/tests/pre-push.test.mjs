import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {repoRoot} from '../agents/lib.mjs';

const hooksDir = path.join(repoRoot, 'platform/git-hooks');
const plannerFiles = ['ci-plan.mjs', 'workflow-test-runs.mjs', 'pre-push-plan.mjs'];
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const identity = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1'
};
const gitEnv = {...cleanEnv, ...identity};
const zeroSha = '0'.repeat(40);

function git(cwd, ...args) {
  return execFileSync('git', args, {cwd, env: gitEnv, encoding: 'utf8'}).trim();
}

function scratchRepository(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-pre-push-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const main = path.join(base, 'main');
  const linked = path.join(base, 'linked');
  const remote = path.join(base, 'remote.git');
  git(base, 'init', '--quiet', '--bare', remote);
  git(base, 'init', '--quiet', '-b', 'main', main);
  git(main, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  git(main, 'remote', 'add', 'origin', remote);
  git(main, 'push', '--quiet', 'origin', 'main');
  git(main, 'worktree', 'add', '--quiet', '-b', 'work', linked);
  return {base, linked};
}

function commitFile(repo, file, content) {
  const absolute = path.join(repo, file);
  fs.mkdirSync(path.dirname(absolute), {recursive: true});
  fs.writeFileSync(absolute, content);
  git(repo, 'add', file);
  git(repo, 'commit', '--quiet', '-m', `change ${file}`);
}

function installHook(repo) {
  fs.cpSync(hooksDir, path.join(repo, 'platform/git-hooks'), {recursive: true});
  fs.mkdirSync(path.join(repo, 'platform/tools'), {recursive: true});
  for (const file of plannerFiles) {
    const source = path.join(repoRoot, 'platform/tools', file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(repo, 'platform/tools', file));
  }
  fs.copyFileSync(path.join(repoRoot, 'Makefile'), path.join(repo, 'Makefile'));
  git(repo, 'config', 'core.hooksPath', 'platform/git-hooks');
}

function recordMake(base) {
  const bin = path.join(base, 'bin');
  const log = path.join(base, 'make.log');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'make'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$MAKE_LOG"\n`, {mode: 0o755});
  fs.writeFileSync(path.join(bin, 'go'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  return {bin, log};
}

function hookEnv(recorder) {
  return {...gitEnv, PATH: `${recorder.bin}${path.delimiter}${process.env.PATH}`, MAKE_LOG: recorder.log};
}

function makeCalls(recorder) {
  if (!fs.existsSync(recorder.log)) return [];
  return fs.readFileSync(recorder.log, 'utf8').split('\n').filter(Boolean);
}

function push(repo, recorder) {
  return spawnSync('git', ['push', '--quiet', 'origin', 'work'], {
    cwd: repo,
    env: hookEnv(recorder),
    encoding: 'utf8'
  });
}

function runHook(repo, recorder, refs) {
  return spawnSync('sh', [path.join(repo, 'platform/git-hooks/pre-push')], {
    cwd: repo,
    env: hookEnv(recorder),
    input: `${refs}\n`,
    encoding: 'utf8'
  });
}

test('a docs-only push selects only the docs checks', t => {
  const {base, linked} = scratchRepository(t);
  commitFile(linked, 'docs/guide.md', '# Guide\n');
  installHook(linked);
  const recorder = recordMake(base);
  const result = push(linked, recorder);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(makeCalls(recorder), ['--no-print-directory verify PKG=docs']);
});

test('a one-app push selects that app and the folders the planner adds', t => {
  const {base, linked} = scratchRepository(t);
  commitFile(linked, 'apps/web/src/new-panel.js', 'export const panel = 1;\n');
  installHook(linked);
  const recorder = recordMake(base);
  const result = push(linked, recorder);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(makeCalls(recorder), [
    '--no-print-directory verify PKG=platform',
    '--no-print-directory verify PKG=tests',
    '--no-print-directory verify PKG=apps/web'
  ]);
});

test('a workflow change runs platform once', t => {
  const {base, linked} = scratchRepository(t);
  commitFile(linked, '.github/workflows/ci-docs.yml', 'name: docs\n');
  installHook(linked);
  const recorder = recordMake(base);
  const result = push(linked, recorder);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(makeCalls(recorder), ['--no-print-directory verify PKG=platform']);
});

test('a backend-only push runs only the Go checks', t => {
  const {base, linked} = scratchRepository(t);
  commitFile(linked, 'services/backend/cmd/server/main.go', 'package main\n');
  installHook(linked);
  const recorder = recordMake(base);
  const result = push(linked, recorder);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /selected check-go/);
  assert.deepEqual(makeCalls(recorder), ['--no-print-directory check-go']);
});

test('an unreadable diff falls back to make check and says why', t => {
  const {base, linked} = scratchRepository(t);
  installHook(linked);
  const recorder = recordMake(base);
  const head = git(linked, 'rev-parse', 'HEAD');
  const result = runHook(linked, recorder, `refs/heads/work ${head} refs/heads/main ${'1'.repeat(40)}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /diff base .* is not a commit; running make check/);
  assert.deepEqual(makeCalls(recorder), ['--no-print-directory check', '--no-print-directory check-go']);
});

test('deleting a ref selects no checks', t => {
  const {base, linked} = scratchRepository(t);
  installHook(linked);
  const recorder = recordMake(base);
  const head = git(linked, 'rev-parse', 'HEAD');
  const result = runHook(linked, recorder, `refs/heads/work ${zeroSha} refs/heads/work ${head}`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /deleted refs only; no checks/);
  assert.deepEqual(makeCalls(recorder), []);
});
