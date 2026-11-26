import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({cwd: appRoot});

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

test('nested runtime files reject readability violations', async () => {
  assert.ok((await lintRuleIds('export const q = 1;\n', 'src/features/map-control.js')).includes('id-length'));
});

test('nested tool files reject readability violations', async () => {
  const code = 'export const first = 1; export const second = 2;\n';
  assert.ok((await lintRuleIds(code, 'tools/nested/reporter.mjs')).includes('max-statements-per-line'));
});

test('runtime and tool helpers keep the function budget', async () => {
  for (const filePath of ['src/helpers/projection.js', 'tools/nested/inventory.mjs']) {
    assert.ok((await lintRuleIds(longFunctionCode(), filePath)).includes('max-lines-per-function'), filePath);
  }
});

test('source unit tests keep node globals and the long-test exception', async () => {
  const globalsCode = 'export function scenario() {\n  return process.env.NODE_ENV;\n}\n';
  assert.deepEqual(await lintRuleIds(globalsCode, 'src/app.test.js'), []);
  assert.deepEqual(await lintRuleIds(longFunctionCode(), 'src/app.test.js'), []);
});

test('component-browser tests keep both globals and the long-test exception', async () => {
  const globalsCode = 'export function scenario() {\n  return window.innerWidth + process.argv.length;\n}\n';
  assert.deepEqual(await lintRuleIds(globalsCode, 'src/app.browser.test.js'), []);
  assert.deepEqual(await lintRuleIds(longFunctionCode(), 'src/app.browser.test.js'), []);
});

test('source unit and component-browser tests still reject readability violations', async () => {
  for (const filePath of ['src/app.test.js', 'src/app.browser.test.js']) {
    assert.ok((await lintRuleIds('export const q = 1;\n', filePath)).includes('id-length'), filePath);
  }
});
