import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {repoRoot} from '../agents/lib.mjs';

const hooksDir = path.join(repoRoot, 'platform/git-hooks');
const guard = path.join(repoRoot, 'platform/tools/require-worktree.sh');
const markdownSuite = path.join(repoRoot, 'platform/tests/markdown.test.mjs');

// These tests may themselves run under a git hook; nothing here may reach the real repository.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
// A developer's global signing or hook settings must not change these results.
const identity = {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1'
};
const gitEnv = {...cleanEnv, ...identity};
const git = (cwd, ...args) => execFileSync('git', args, {cwd, env: gitEnv, encoding: 'utf8'}).trim();

function repoWithWorktree(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-worktree-guard-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const main = path.join(base, 'main');
  const linked = path.join(base, 'linked');
  git(base, 'init', '--quiet', main);
  git(main, 'commit', '--quiet', '--allow-empty', '-m', 'first');
  git(main, 'worktree', 'add', '--quiet', '-b', 'work', linked);
  return {base, main, linked, linkedGitDir: git(linked, 'rev-parse', '--absolute-git-dir')};
}

test('the guard rejects the main checkout and allows a linked worktree', t => {
  const {main, linked, linkedGitDir} = repoWithWorktree(t);
  const inMain = spawnSync('sh', [guard], {cwd: main, env: cleanEnv, encoding: 'utf8'});
  assert.equal(inMain.status, 1);
  assert.match(inMain.stderr, /make worktree NAME=<branch>/);
  assert.equal(spawnSync('sh', [guard], {cwd: linked, env: cleanEnv}).status, 0);
  // Git exports GIT_DIR to hooks, which must not make a linked worktree look like the main checkout.
  assert.equal(spawnSync('sh', [guard], {cwd: linked, env: {...cleanEnv, GIT_DIR: linkedGitDir}}).status, 0);
});

test('the pre-commit hook blocks a commit in the main checkout', t => {
  const {main} = repoWithWorktree(t);
  const before = git(main, 'rev-parse', 'HEAD');
  git(main, 'config', 'core.hooksPath', hooksDir);
  const commit = spawnSync('git', ['commit', '--allow-empty', '-m', 'blocked'], {cwd: main, env: gitEnv, encoding: 'utf8'});
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /not allowed in the main checkout/);
  assert.equal(git(main, 'rev-parse', 'HEAD'), before);
});

test('with hooks set up as make setup does, the main checkout rejects commits but can still merge', t => {
  const {main, linked} = repoWithWorktree(t);
  git(linked, 'commit', '--quiet', '--allow-empty', '-m', 'work');
  git(main, 'commit', '--quiet', '--allow-empty', '-m', 'main moved on');
  fs.cpSync(hooksDir, path.join(main, 'platform/git-hooks'), {recursive: true});
  fs.mkdirSync(path.join(main, 'platform/tools'));
  fs.copyFileSync(guard, path.join(main, 'platform/tools/require-worktree.sh'));
  git(main, 'config', 'core.hooksPath', 'platform/git-hooks');
  const commit = spawnSync('git', ['commit', '--allow-empty', '-m', 'blocked'], {cwd: main, env: gitEnv, encoding: 'utf8'});
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /not allowed in the main checkout/);
  git(main, 'merge', '--quiet', '--no-ff', '-m', 'merge work', 'work');
  assert.equal(git(main, 'log', '-1', '--format=%s'), 'merge work');
});

test('the pre-push hook hides git variables from its checks', t => {
  const {base, main, linked} = repoWithWorktree(t);
  const remote = path.join(base, 'remote.git');
  git(base, 'init', '--quiet', '--bare', remote);
  git(main, 'config', 'core.hooksPath', hooksDir);
  git(linked, 'remote', 'add', 'origin', remote);
  // A stand-in make records what the real checks would inherit.
  const bin = path.join(base, 'bin');
  const seen = path.join(base, 'make-env');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'make'), `#!/bin/sh\nenv >> "${seen}"\n`, {mode: 0o755});
  execFileSync('git', ['push', '--quiet', 'origin', 'work'], {cwd: linked, env: {...gitEnv, PATH: `${bin}${path.delimiter}${process.env.PATH}`}});
  const inherited = fs.readFileSync(seen, 'utf8');
  assert.doesNotMatch(inherited, /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)=/m);
});

test('the Markdown suite leaves the repository of an inherited GIT_DIR untouched', t => {
  const {main, linkedGitDir} = repoWithWorktree(t);
  // A nested test runner that inherits NODE_TEST_CONTEXT would report success without running anything.
  const suiteEnv = {...cleanEnv};
  delete suiteEnv.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=Markdown checks find', markdownSuite], {
    cwd: repoRoot, env: {...suiteEnv, GIT_DIR: linkedGitDir}, encoding: 'utf8'
  });
  assert.equal(run.status, 0, run.stdout);
  assert.match(run.stdout, /^# pass 1$/m);
  assert.equal(git(main, 'config', 'core.bare'), 'false');
});
