import test from 'node:test';
import assert from 'node:assert/strict';
import {ESLint} from 'eslint';
import {repoRoot} from '../agents/lib.mjs';

// Lints sample code as if it lived at filePath, through the repository's real eslint.config.mjs, so a removed rule or a
// narrowed files glob fails here even while every checked-in file is already clean.
async function ruleIds(code, filePath) {
  const eslint = new ESLint({cwd: repoRoot});
  const [result] = await eslint.lintText(code, {filePath});
  return result.messages.map(message => message.ruleId);
}

const sourcePath = 'apps/web/src/readability-probe.js';
const testPath = 'apps/web/tests/readability-probe.test.mjs';
const longBody = count => Array.from({length: count}, (_, index) => `  total += ${index};`).join('\n');

test('apps/ source rejects each mechanical readability violation', async () => {
  const violations = {
    'max-statements-per-line': 'export const first = 1; export const second = 2;\n',
    'id-length': 'export const q = 1;\n',
    'max-depth': 'export function deep(a1, a2, a3, a4) {\n  if (a1) { if (a2) { if (a3) { if (a4) return 1; } } }\n  return 0;\n}\n',
    'max-lines-per-function': `export function long() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`
  };
  for (const [ruleId, code] of Object.entries(violations)) {
    assert.ok((await ruleIds(code, sourcePath)).includes(ruleId), ruleId);
  }
});

test('the documented exceptions pass: coordinates, object keys and long test functions', async () => {
  const exceptions = 'export const point = {a: 1, б: 2};\nexport const offset = (x, y, z) => x + y + z;\n';
  assert.deepEqual(await ruleIds(exceptions, sourcePath), []);
  const longTest = `export function scenario() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`;
  assert.ok(!(await ruleIds(longTest, testPath)).includes('max-lines-per-function'));
});
