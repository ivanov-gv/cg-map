import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

// Each project's test calls this with its own root, so it proves that project's real config still carries the rules.
async function ruleIds(cwd, code, filePath) {
  const eslint = new ESLint({cwd});
  const [result] = await eslint.lintText(code, {filePath});
  return result.messages.map(message => message.ruleId);
}

const sourcePath = 'src/readability-probe.js';
const testPath = 'tests/readability-probe.test.mjs';
const longBody = count => Array.from({length: count}, (_, index) => `  total += ${index};`).join('\n');

export async function assertReadabilityRules(projectRoot) {
  const cwd = fileURLToPath(projectRoot);
  const violations = {
    'max-statements-per-line': 'export const first = 1; export const second = 2;\n',
    'id-length': 'export const q = 1;\n',
    'max-depth': 'export function deep(a1, a2, a3, a4) {\n  if (a1) { if (a2) { if (a3) { if (a4) return 1; } } }\n  return 0;\n}\n',
    'max-lines-per-function': `export function long() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`
  };
  for (const [ruleId, code] of Object.entries(violations)) {
    assert.ok((await ruleIds(cwd, code, sourcePath)).includes(ruleId), `${ruleId} is missing`);
  }

  const exceptions = 'export const point = {a: 1, б: 2};\nexport const offset = (x, y, z) => x + y + z;\n';
  assert.deepEqual(await ruleIds(cwd, exceptions, sourcePath), []);
  const longTest = `export function scenario() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`;
  assert.ok(!(await ruleIds(cwd, longTest, testPath)).includes('max-lines-per-function'));
}
