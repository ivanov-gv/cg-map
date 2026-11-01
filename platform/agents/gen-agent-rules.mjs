#!/usr/bin/env node
// Generate agent adapters from docs/engineering/*.md (mapping: platform/agents/guidelines.json).
//   node platform/agents/gen-agent-rules.mjs          write adapters
//   node platform/agents/gen-agent-rules.mjs --check  fail on drift or budget violations (CI)
// Outputs:
//   .claude/rules/<id>.md       Claude Code path-scoped rules (`paths` frontmatter)
//   <component>/AGENTS.md       generated block for Codex, which loads AGENTS.md from root to its startup cwd
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {repoRoot, loadConfig, readGuideline, stripTitle, rewriteLinks} from './lib.mjs';

const BEGIN = '<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->';
const END = '<!-- END GENERATED agent-guidelines -->';
const RULES_DIR = '.claude/rules';

export async function buildOutputs(root = repoRoot) {
  const config = loadConfig(root);
  const outputs = new Map();
  const problems = [];
  const byComponent = new Map();

  for (const g of config.guidelines) {
    const {text, hash} = readGuideline(g, root);
    if (Buffer.byteLength(text) > config.limits.guidelineMaxBytes) {
      problems.push(`${g.source}: ${Buffer.byteLength(text)} bytes exceeds ${config.limits.guidelineMaxBytes}; move explanations to linked docs or convert rules to checks.`);
    }
    const {title, rest} = stripTitle(text);
    const rule = [
      '---',
      `description: ${title} (generated from ${g.source})`,
      'paths:',
      ...g.paths.map(p => `  - "${p}"`),
      '---',
      `<!-- GENERATED from ${g.source} sha256:${hash}`,
      'by platform/agents/gen-agent-rules.mjs. Do not edit; run `make agent-rules`. -->',
      '',
      `# ${title}`,
      '',
      rewriteLinks(rest, g.source, null).trimEnd(),
      ''
    ].join('\n');
    outputs.set(`${RULES_DIR}/${g.id}.md`, rule);
    for (const component of g.components) {
      if (!byComponent.has(component)) byComponent.set(component, []);
      byComponent.get(component).push({g, title, rest, hash});
    }
  }

  for (const [component, items] of byComponent) {
    const file = `${component}/AGENTS.md`;
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) { problems.push(`${file}: missing; guidelines.json routes ${items.map(i => i.g.id).join(', ')} here.`); continue; }
    const current = fs.readFileSync(abs, 'utf8');
    const block = [BEGIN, ...items.flatMap(({g, title, rest, hash}) => [
      `<!-- agent-guideline: ${g.id} sha256:${hash} -->`,
      `## ${title} (from ${path.posix.relative(component, g.source)})`,
      '',
      rewriteLinks(rest, g.source, file).replace(/^## /gm, '### ').trimEnd(),
      ''
    ]), END].join('\n');
    const start = current.indexOf(BEGIN);
    const end = current.indexOf(END);
    const handWritten = start >= 0 && end > start ? current.slice(0, start).trimEnd() + current.slice(end + END.length).replace(/^\s*\n/, '\n') : current.trimEnd();
    outputs.set(file, `${handWritten.trimEnd()}\n\n${block}\n`);
  }

  // Format as part of generation so sources and generated Markdown share the same style.
  for (const [file, text] of outputs) {
    const filepath = path.join(root, file);
    const options = await resolveConfig(filepath);
    outputs.set(file, await format(text, {...options, filepath}));
  }

  // Codex concatenates AGENTS.md from the project root to the startup cwd under one byte budget.
  const rootAgents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const rootLines = rootAgents.trimEnd().split('\n').length;
  if (rootLines > config.limits.rootAgentsMaxLines) problems.push(`AGENTS.md: ${rootLines} lines exceeds ${config.limits.rootAgentsMaxLines}; move detail into linked docs.`);
  for (const [file, text] of outputs) {
    if (!file.endsWith('/AGENTS.md')) continue;
    let chain = Buffer.byteLength(rootAgents) + Buffer.byteLength(text);
    for (let dir = path.posix.dirname(path.posix.dirname(file)); dir !== '.'; dir = path.posix.dirname(dir)) {
      const parent = path.join(root, dir, 'AGENTS.md');
      if (fs.existsSync(parent)) chain += fs.statSync(parent).size;
    }
    if (chain > config.limits.codexChainMaxBytes) problems.push(`${file}: AGENTS.md chain is ${chain} bytes, over Codex's ${config.limits.codexChainMaxBytes}-byte project_doc_max_bytes; later files would be truncated.`);
  }
  return {outputs, problems};
}

function trackedOverrides(root) {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*AGENTS.override.md'], {cwd: root, encoding: 'utf8'}).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export async function run({check = false, root = repoRoot} = {}) {
  const {outputs, problems} = await buildOutputs(root);
  for (const file of trackedOverrides(root)) problems.push(`${file}: AGENTS.override.md replaces AGENTS.md for Codex; keep overrides personal and untracked.`);
  const rulesDir = path.join(root, RULES_DIR);
  const stale = fs.existsSync(rulesDir) ? fs.readdirSync(rulesDir).map(f => `${RULES_DIR}/${f}`).filter(f => !outputs.has(f)) : [];
  const drift = [...outputs].filter(([file, text]) => !fs.existsSync(path.join(root, file)) || fs.readFileSync(path.join(root, file), 'utf8') !== text).map(([file]) => file);

  if (check) {
    for (const file of drift) problems.push(`${file}: out of date with docs/engineering; run \`make agent-rules\` and commit the result.`);
    for (const file of stale) problems.push(`${file}: not produced by platform/agents/guidelines.json; ${RULES_DIR} is generated, remove it or add a mapping.`);
  } else {
    fs.mkdirSync(rulesDir, {recursive: true});
    for (const file of stale) fs.rmSync(path.join(root, file));
    for (const file of drift) fs.writeFileSync(path.join(root, file), outputs.get(file));
    for (const file of [...drift, ...stale]) console.log(`${stale.includes(file) ? 'removed' : 'wrote'} ${file}`);
  }
  if (problems.length) {
    console.error(problems.map(p => `agent-rules: ${p}`).join('\n'));
    return 1;
  }
  console.log(check ? `Agent adapters match ${outputs.size} generated files; budgets OK.` : 'Agent adapters up to date.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run({check: process.argv.includes('--check')});
