import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const projectFilePath = /\b(?:apps|packages|services|data|platform|tests)\/[\w./-]+\.(?:js|mjs|cjs|json)\b/;

// Shared rules are development tooling, not a map of project files: a concrete path would couple every lint config to
// another project's layout. This throws unless the real rules module under root names no project file.
export function assertSharedRulesHaveNoProjectFiles(root = process.cwd()) {
  const rulesFile = path.join(root, 'platform', 'eslint-rules.mjs');
  const text = fs.readFileSync(rulesFile, 'utf8');
  assert.ok(
    !projectFilePath.test(text),
    `${path.relative(root, rulesFile)} must not name a project file; put project patterns in that project's config`
  );
}
