import test from 'node:test';
import assert from 'node:assert/strict';
import {lintGroups, lintStaged} from '../tools/staged-lint.mjs';

const ownConfigs = new Set(['data/eslint.config.mjs', 'platform/eslint.config.mjs', 'eslint.config.mjs']);
const configExists = file => ownConfigs.has(file);

test('an app file without its own config keeps its root-relative path', () => {
  assert.deepEqual(lintGroups(['apps/web/src/app.js'], configExists), [
    {cwd: '.', files: ['apps/web/src/app.js']}
  ]);
});

test('a project config lints its files from that project, while the rest use the root config', () => {
  const files = ['data/tools/build.mjs', 'apps/editor/tools/run.mjs', 'eslint.config.mjs'];
  assert.deepEqual(lintGroups(files, configExists), [
    {cwd: 'data', files: ['tools/build.mjs']},
    {cwd: '.', files: ['apps/editor/tools/run.mjs', 'eslint.config.mjs']}
  ]);
});

test('a lint failure in one config stops the hook with a nonzero status', () => {
  const calls = [];
  const runEslint = (cwd, files) => {
    calls.push([cwd, files]);
    return cwd === 'data' ? 1 : 0;
  };
  const files = ['apps/web/src/app.js', 'data/tools/build.mjs', 'tests/integration/check.mjs', 'platform/tools/check.mjs'];
  assert.equal(lintStaged(files, runEslint, configExists), 1);
  assert.deepEqual(calls, [
    ['.', ['apps/web/src/app.js', 'tests/integration/check.mjs']],
    ['data', ['tools/build.mjs']]
  ]);
});
