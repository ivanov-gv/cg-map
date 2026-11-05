#!/usr/bin/env node
// Fix authored Markdown, then regenerate agent rules instead of editing generated text.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {format, resolveConfig} from 'prettier';
import {main as markdownlint} from 'markdownlint-cli2';
import {buildOutputs, run as generateAgents} from '../agents/gen-agent-rules.mjs';
import {repoRoot} from '../agents/lib.mjs';

export async function run({root = repoRoot} = {}) {
  const {outputs, problems} = await buildOutputs(root);
  if (problems.length) throw new Error(problems.join('\n'));
  const generated = new Set(outputs.keys());
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.md'], {cwd: root, encoding: 'utf8'});
  const files = [...new Set(listed.split('\0').filter(file => file && fs.existsSync(path.join(root, file))))].sort();
  const authored = files.filter(file => !generated.has(file));

  // cli2's --no-globs keeps the root's all-file glob from fixing generated rules.
  const literalPaths = authored.map(file => ':' + file);
  const fixed = await markdownlint({directory: root, argv: ['--no-globs', '--fix', ...literalPaths], logMessage: console.log, logError: console.error});
  for (const file of authored) {
    const filepath = path.join(root, file);
    const text = fs.readFileSync(filepath, 'utf8');
    const options = await resolveConfig(filepath);
    const formatted = await format(text, {...options, filepath});
    if (formatted !== text) {
      fs.writeFileSync(filepath, formatted);
      console.log(`formatted ${file}`);
    }
  }
  const generatedStatus = await generateAgents({root});
  // A non-fixable lint error must still fail after formatting/regeneration.
  const checked = await markdownlint({directory: root, logMessage: console.log, logError: console.error});
  return generatedStatus || checked || (fixed > 1 ? fixed : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
