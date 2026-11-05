import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {globToRegExp, guidelinesForPath, loadConfig, rewriteLinks, repoRoot} from '../agents/lib.mjs';
import {run} from '../agents/gen-agent-rules.mjs';
import {componentFor} from '../tools/verify.mjs';

const config = loadConfig();
const ids = list => list.map(g => g.id).sort();

// guidelines.json paths become .claude/rules frontmatter; check that each file type gets exactly its rules.
test('guideline path scopes select the readability rule and only the matching language guideline', () => {
  assert.ok(globToRegExp('**/*.go').test('main.go'));
  assert.ok(globToRegExp('**/*.go').test('services/new-svc/cmd/x.go'));
  assert.ok(!globToRegExp('**/*.go').test('services/x.gox'));
  assert.deepEqual(ids(guidelinesForPath(config, 'services/backend/cmd/server/main.go')), ['go', 'readability']);
  assert.deepEqual(ids(guidelinesForPath(config, 'services/payments/go.mod')), ['go'], 'a new Go module is in scope from its go.mod');
  assert.deepEqual(ids(guidelinesForPath(config, 'data/tools/pack.py')), ['python', 'readability']);
  assert.deepEqual(ids(guidelinesForPath(config, 'apps/web/src/app.js')), ['javascript', 'readability', 'ui']);
  assert.deepEqual(ids(guidelinesForPath(config, 'apps/web/public/style.css')), ['readability', 'ui']);
  assert.deepEqual(ids(guidelinesForPath(config, 'README.md')), []);
});

test('guidelines are not copied into AGENTS.md, and readability reaches the listed code file types', () => {
  // every agent loads the root AGENTS.md, which links to the guidelines
  const agentsFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*AGENTS.md'], {cwd: repoRoot, encoding: 'utf8'}).split('\n').filter(Boolean);
  for (const file of agentsFiles) {
    assert.doesNotMatch(fs.readFileSync(path.join(repoRoot, file), 'utf8'), /BEGIN GENERATED/, file);
  }
  const codeFiles = ['services/backend/x.go', 'tests/integration/x.test.mjs', 'apps/web/src/x.js', 'data/tools/x.py', 'platform/tools/x.sh', 'apps/web/public/x.css', 'apps/web/public/x.html', 'packages/contracts/proto/x.proto', 'services/backend/Makefile', 'platform/docs.mk', 'platform/git-hooks/pre-commit', '.github/workflows/x.yml'];
  for (const file of codeFiles) {
    assert.ok(ids(guidelinesForPath(config, file)).includes('readability'), file);
  }
  const rootAgents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  for (const guideline of config.guidelines) {
    assert.ok(rootAgents.includes(guideline.source), `root AGENTS.md links to ${guideline.source}`);
  }
  assert.match(rootAgents, /Read \[readability\]\(docs\/engineering\/readability\.md\)/, 'root AGENTS.md tells agents to read the rule');
});

test('generated rule links become repo-relative', () => {
  assert.equal(rewriteLinks('[o](../system-architecture/ownership.md#x) [w](https://x.y)', 'docs/engineering/go.md'), '[o](docs/system-architecture/ownership.md#x) [w](https://x.y)');
});

test('committed agent rules match canonical docs and budgets', async () => {
  assert.equal(await run({check: true}), 0);
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
