#!/usr/bin/env node
// Stable per-checkout ports so parallel worktrees (claude --worktree, git worktree add) never collide.
// The main checkout keeps the documented defaults; linked worktrees get a port derived from their path.
//   node platform/tools/dev-port.mjs        dev server port (default 8080)
//   node platform/tools/dev-port.mjs --e2e  Playwright server port (default 8095)
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const e2e = process.argv.includes('--e2e');
let top = '';
let linked = false;
try {
  const [toplevel, gitDir] = execFileSync('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], {encoding: 'utf8'}).trim().split('\n');
  top = toplevel;
  linked = !gitDir.endsWith('/.git'); // linked worktrees use <common>/.git/worktrees/<name>
} catch { /* not a git checkout: use defaults */ }

if (!linked) console.log(e2e ? 8095 : 8080);
else {
  const offset = parseInt(crypto.createHash('sha256').update(top).digest('hex').slice(0, 8), 16) % 400;
  console.log((e2e ? 9200 : 8200) + offset * 2);
}
