#!/usr/bin/env node
// Generate path-scoped Claude Code rules from docs/engineering/*.md (mapping: platform/agents/guidelines.json).
//   node platform/agents/gen-agent-rules.mjs          write rules
//   node platform/agents/gen-agent-rules.mjs --check  fail on drift or budget violations (CI)
// Output: .claude/rules/<id>.md, with `paths` frontmatter. Other agents read the guidelines through the root AGENTS.md.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {repoRoot, loadConfig, readGuideline, stripTitle, rewriteLinks} from './lib.mjs';

const RULES_DIR = '.claude/rules';

export async function buildOutputs(root = repoRoot) {
  const config = loadConfig(root);
  const outputs = new Map();
  const problems = [];

  for (const g of config.guidelines) {
    const text = readGuideline(g, root);
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
      `<!-- GENERATED from ${g.source}`,
      'by platform/agents/gen-agent-rules.mjs. Do not edit; run `make agent-rules`. -->',
      '',
      `# ${title}`,
      '',
      rewriteLinks(rest, g.source).trimEnd(),
      ''
    ].join('\n');
    outputs.set(`${RULES_DIR}/${g.id}.md`, rule);
  }

  // Format as part of generation so sources and generated Markdown share the same style.
  for (const [file, text] of outputs) {
    const filepath = path.join(root, file);
    const options = await resolveConfig(filepath);
    outputs.set(file, await format(text, {...options, filepath}));
  }

  const rootAgents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const rootLines = rootAgents.trimEnd().split('\n').length;
  if (rootLines > config.limits.rootAgentsMaxLines) problems.push(`AGENTS.md: ${rootLines} lines exceeds ${config.limits.rootAgentsMaxLines}; move detail into linked docs.`);
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
  console.log(check ? `Agent rules match ${outputs.size} generated files; budgets OK.` : 'Agent rules up to date.');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run({check: process.argv.includes('--check')});
