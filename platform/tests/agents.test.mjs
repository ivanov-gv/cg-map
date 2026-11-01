import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {globToRegExp, guidelinesForPath, loadConfig, rewriteLinks, repoRoot} from '../agents/lib.mjs';
import {run} from '../agents/gen-agent-rules.mjs';
import {componentFor} from '../tools/verify.mjs';

const config = loadConfig();
const ids = list => list.map(g => g.id).sort();

// guidelines.json paths become .claude/rules frontmatter; check that each file type gets exactly its rules.
test('guideline path scopes select only the matching language guideline', () => {
  assert.ok(globToRegExp('**/*.go').test('main.go'));
  assert.ok(globToRegExp('**/*.go').test('services/new-svc/cmd/x.go'));
  assert.ok(!globToRegExp('**/*.go').test('services/x.gox'));
  assert.deepEqual(ids(guidelinesForPath(config, 'services/backend/cmd/server/main.go')), ['go']);
  assert.deepEqual(ids(guidelinesForPath(config, 'services/payments/go.mod')), ['go'], 'a new Go module is in scope from its go.mod');
  assert.deepEqual(ids(guidelinesForPath(config, 'data/tools/pack.py')), ['python']);
  assert.deepEqual(ids(guidelinesForPath(config, 'apps/web/src/app.js')), ['javascript', 'ui']);
  assert.deepEqual(ids(guidelinesForPath(config, 'apps/web/public/style.css')), ['ui']);
  assert.deepEqual(ids(guidelinesForPath(config, 'README.md')), []);
});

test('generated links resolve from their new location', () => {
  assert.equal(rewriteLinks('[o](../ownership.md)', 'docs/engineering/go.md', 'services/backend/AGENTS.md'), '[o](../../docs/ownership.md)');
  assert.equal(rewriteLinks('[o](../ownership.md#x) [w](https://x.y)', 'docs/engineering/go.md', null), '[o](docs/ownership.md#x) [w](https://x.y)');
});

test('committed agent adapters match canonical docs and budgets', () => {
  assert.equal(run({check: true}), 0);
});

test('agents are wired without hooks, and the workflow ends with the compliance review', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.hooks, undefined, 'agent hooks were removed; checks live in Make targets, git hooks and CI');
  assert.ok(!fs.existsSync(path.join(repoRoot, '.codex/hooks.json')));
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.match(agents, /agents:compliance-reviewer/, 'Claude Code reviewer named in the workflow');
  assert.match(agents, /compliance_reviewer/, 'Codex reviewer named in the workflow');
});

test('make verify maps paths to owning components', () => {
  assert.equal(componentFor('services/backend/cmd/server/main.go'), 'services/backend');
  assert.equal(componentFor('apps/web/src/app.js'), 'apps/web');
  assert.equal(componentFor('data/'), 'data');
  assert.equal(componentFor('.claude/settings.json'), 'platform');
  assert.equal(componentFor('unknown/x'), null);
});
