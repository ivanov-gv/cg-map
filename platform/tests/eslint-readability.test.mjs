import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {ESLint} from 'eslint';
import {repoRoot} from '../agents/lib.mjs';

// Lints samples as if they lived at filePath through Platform's own config. App-level readability probes moved to the
// owning app configs when the root config was retired (ADR 0043).
const platformRoot = path.join(repoRoot, 'platform');
const eslint = new ESLint({cwd: platformRoot});
const toolPath = 'tools/readability-probe.mjs';
const testPath = 'tests/readability-probe.test.mjs';

async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, {filePath: path.join(platformRoot, filePath)});
  return result.messages.map(message => message.ruleId);
}

test('platform tooling rejects each shared common rule violation', async () => {
  const violations = {
    'no-unused-vars': 'const unused = 1;\n',
    'no-constant-binary-expression': 'export const value = false && 1;\n'
  };
  for (const [ruleId, code] of Object.entries(violations)) {
    assert.ok((await ruleIds(code, toolPath)).includes(ruleId), ruleId);
    assert.ok((await ruleIds(code, testPath)).includes(ruleId), `${ruleId} in a test file`);
  }
});

test('the documented parameter and object-key exceptions pass', async () => {
  const exceptions = [
    'export function combine(first, _unused) {',
    '  return first;',
    '}',
    'export const point = {a: 1, б: 2};',
    'export const offset = (x, y, z) => x + y + z;',
    ''
  ].join('\n');
  for (const filePath of [toolPath, testPath]) {
    assert.deepEqual(await ruleIds(exceptions, filePath), [], filePath);
  }
});
