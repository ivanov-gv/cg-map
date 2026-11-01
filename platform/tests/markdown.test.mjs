import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {main as markdownlint} from 'markdownlint-cli2';
import parseYaml from 'markdownlint-cli2/parsers/yaml';
import {check, resolveConfig} from 'prettier';
import {run as formatMarkdown} from '../tools/format-markdown.mjs';
import {buildOutputs} from '../agents/gen-agent-rules.mjs';
import {globToRegExp, repoRoot} from '../agents/lib.mjs';

test('Markdown checks find new and hidden sources; fixes regenerate adapters and preserve code', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-markdown-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const write = (file, text) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, text);
  };
  execFileSync('git', ['init', '--quiet', root]);
  for (const file of ['.markdownlint.jsonc', '.markdownlint-cli2.jsonc', '.prettierrc.json', '.editorconfig']) {
    write(file, fs.readFileSync(path.join(repoRoot, file), 'utf8'));
  }
  write('.gitignore', 'node_modules/\ndist/\n');
  write('AGENTS.md', '# Project\n\nRoot instructions.\n');
  write('apps/web/AGENTS.md', '# Component\n\nAuthored instructions.\n');
  write('platform/agents/guidelines.json', JSON.stringify({
    limits: {rootAgentsMaxLines: 100, guidelineMaxBytes: 8192, codexChainMaxBytes: 32768},
    guidelines: [{id: 'example', source: 'docs/engineering/example.md', paths: ['**/*.js'], components: ['apps/web']}]
  }));
  const code = '```js\nconst value=  1;\n```';
  const prose = 'This paragraph describes a useful map with clear roads, building addresses, terrain and places. '.repeat(8).trim();
  write('docs/engineering/example.md', `# Example\n\n| Kind | Guide |\n| --- | --- |\n| Code | [Guide](../ownership.md) |\n\n${prose}\n\n${code}\n`);
  const sourceFiles = ['README.md', 'docs/nested/new.md', '.github/new.md', 'services/backend/new.md', 'docs/with spaces [draft].md'];
  for (const file of sourceFiles) write(file, '# Title\nBody.\n');
  write('node_modules/ignored.md', '# Ignored\nBad markdown.\n');
  write('dist/ignored.md', '# Ignored\nBad markdown.\n');
  const messages = [];
  assert.equal(await markdownlint({directory: root, logError: message => messages.push(message)}), 1);
  const errors = messages.join('\n');
  for (const file of sourceFiles) assert.ok(errors.includes(file), `${file} must be linted without being staged`);
  assert.ok(!errors.includes('ignored.md'), 'dependencies and built artifacts stay outside the source check');

  assert.equal(await formatMarkdown({root}), 0);
  const formatted = fs.readFileSync(path.join(root, 'docs/engineering/example.md'), 'utf8');
  assert.ok(formatted.includes(code), 'embedded code is not reformatted');
  const paragraph = formatted.split('\n\n').find(block => block.startsWith('This paragraph'));
  assert.ok(paragraph.split('\n').length > 1, 'long prose must receive physical line breaks');
  assert.ok(paragraph.split('\n').every(line => line.length <= 120), 'prose must fit the 120-column margin');
  assert.equal(paragraph.replaceAll('\n', ' '), prose, 'wrapping must preserve paragraph content');
  const {outputs} = await buildOutputs(root);
  for (const [file, expected] of outputs) {
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), expected, `${file} must come from canonical generation`);
  }
  assert.match(outputs.get('.claude/rules/example.md'), /\]\(docs\/ownership\.md\)/);
  for (const text of outputs.values()) {
    assert.ok(!text.includes(prose), 'generated prose must be wrapped too');
    assert.ok(text.replace(/\s+/g, ' ').includes(prose), 'regeneration preserves prose content');
  }
  const checkedFiles = [...sourceFiles, 'AGENTS.md', 'docs/engineering/example.md', ...outputs.keys()];
  const before = new Map();
  for (const file of checkedFiles) {
    const filepath = path.join(root, file);
    const text = fs.readFileSync(filepath, 'utf8');
    const options = await resolveConfig(filepath);
    assert.equal(await check(text, {...options, filepath}), true, `${file} must have consistent formatting`);
    before.set(file, text);
  }
  assert.equal(await formatMarkdown({root}), 0);
  for (const [file, text] of before) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), text, 'formatting must be idempotent');

  write('docs/missing-language.md', '# Example\n\n```\nexample\n```\n');
  assert.equal(await formatMarkdown({root}), 1, 'non-fixable semantic lint findings must fail');
});

test('web CI includes backend Markdown changes while leaving Go-only checks independent', () => {
  const workflow = parseYaml(fs.readFileSync(path.join(repoRoot, '.github/workflows/web.yml'), 'utf8'));
  for (const event of ['push', 'pull_request']) {
    const ignored = workflow.on[event]['paths-ignore'].map(globToRegExp);
    for (const file of ['README.md', '.github/new.md', 'services/backend/README.md', 'services/backend/nested/new.md']) {
      assert.equal(ignored.some(pattern => pattern.test(file)), false, `${event} must check ${file}`);
    }
    assert.equal(ignored.some(pattern => pattern.test('services/backend/cmd/server/main.go')), true);
  }
});
