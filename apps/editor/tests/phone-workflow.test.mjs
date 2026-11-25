import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = file => fileSystem.readFileSync(new URL(file, repositoryRoot), 'utf8');

// The editor owns this workflow input: the gate chooses tagged or all, the app forwards it, and its config applies it.
test('the editor keeps its phone input through CI and the browser config', () => {
  assert.match(read('.github/workflows/ci-pr-checks.yml'), /phone_tests: \$\{\{ inputs\.phone_tests \|\| 'tagged' \}\}/);
  assert.match(read('.github/workflows/ci-apps-editor.yml'), /E2E_PHONE: \$\{\{ inputs\.phone_tests \}\}/);
  assert.match(read('apps/editor/playwright.config.mjs'), /process\.env\.E2E_PHONE === 'tagged' \? \{grep: \/@phone\/\}/);
});
