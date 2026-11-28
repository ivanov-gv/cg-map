import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertSharedRulesHaveNoProjectFiles} from '../tools/shared-rule-boundary.mjs';
import {repoRoot} from '../agents/lib.mjs';

test('the shared-rule guard rejects a project path added to the real rules source', context => {
  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-rule-boundary-'));
  context.after(() => fs.rmSync(scratchRoot, {recursive: true, force: true}));
  const rulesFile = path.join(scratchRoot, 'platform', 'eslint-rules.mjs');
  fs.mkdirSync(path.dirname(rulesFile), {recursive: true});

  const realRules = fs.readFileSync(path.join(repoRoot, 'platform', 'eslint-rules.mjs'), 'utf8');
  fs.writeFileSync(rulesFile, realRules);
  assert.doesNotThrow(() => assertSharedRulesHaveNoProjectFiles(scratchRoot));

  fs.writeFileSync(rulesFile, `${realRules}\nexport const forbiddenProjectPath = 'apps/web/src/shared/core.js';\n`);
  assert.throws(() => assertSharedRulesHaveNoProjectFiles(scratchRoot), /must not name a project file/);
});
