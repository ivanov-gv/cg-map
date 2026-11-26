import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({cwd: appRoot});
const processGlobalsCode = 'export function scenario() {\n  return process.env.NODE_ENV;\n}\n';

async function lintRuleIds(code, relativePath) {
  const [result] = await eslint.lintText(code, {filePath: path.join(appRoot, relativePath)});
  return result.messages.map(message => message.ruleId);
}

function repeatedStatements(count) {
  return Array.from({length: count}, (_, index) => `  total += ${index};`).join('\n');
}

function longFunctionCode() {
  return `export function calculateTotal() {\n  let total = 0;\n${repeatedStatements(85)}\n  return total;\n}\n`;
}

function deeplyNestedFunctionCode() {
  return `export function hasNestedValue(groups) {
  for (const group of groups) {
    if (group) {
      for (const item of group) {
        if (item) {
          return true;
        }
      }
    }
  }
  return false;
}
`;
}

test('nested runtime files reject readability violations', async () => {
  assert.ok((await lintRuleIds('export const q = 1;\n', 'src/features/map-control.js')).includes('id-length'));
});

test('nested tool files reject readability violations', async () => {
  const code = 'export const first = 1; export const second = 2;\n';
  assert.ok((await lintRuleIds(code, 'tools/nested/reporter.mjs')).includes('max-statements-per-line'));
});

test('runtime files accept intentionally unused parameters', async () => {
  const code = 'export function combine(first, _unused) {\n  return first;\n}\n';
  assert.deepEqual(await lintRuleIds(code, 'src/helpers/combine.js'), []);
});

test('nested runtime files reject excessive block depth', async () => {
  assert.ok((await lintRuleIds(deeplyNestedFunctionCode(), 'src/helpers/nesting.js')).includes('max-depth'));
});

test('runtime and tool helpers keep the function budget', async () => {
  const filePaths = ['src/helpers/projection.js', 'tools/nested/inventory.mjs', 'tools/nested/inventory.js'];
  for (const filePath of filePaths) {
    assert.ok((await lintRuleIds(longFunctionCode(), filePath)).includes('max-lines-per-function'), filePath);
  }
});

test('source unit tests keep node globals and the long-test exception', async () => {
  assert.deepEqual(await lintRuleIds(processGlobalsCode, 'src/app.test.js'), []);
  assert.deepEqual(await lintRuleIds(longFunctionCode(), 'src/app.test.js'), []);
});

test('component-browser tests keep both globals and the long-test exception', async () => {
  const globalsCode = 'export function scenario() {\n  return window.innerWidth + process.argv.length;\n}\n';
  assert.deepEqual(await lintRuleIds(globalsCode, 'src/app.browser.test.js'), []);
  assert.deepEqual(await lintRuleIds(longFunctionCode(), 'src/app.browser.test.js'), []);
});

test('journey files keep node globals and readability', async () => {
  const filePaths = ['e2e/concepts.spec.js', 'tests/e2e/x.spec.mjs'];
  for (const filePath of filePaths) {
    assert.deepEqual(await lintRuleIds(processGlobalsCode, filePath), [], filePath);
    assert.ok((await lintRuleIds('export const q = 1;\n', filePath)).includes('id-length'), filePath);
  }
});

test('source unit and component-browser tests still reject readability violations', async () => {
  for (const filePath of ['src/app.test.js', 'src/app.browser.test.js']) {
    assert.ok((await lintRuleIds('export const q = 1;\n', filePath)).includes('id-length'), filePath);
  }
});
