#!/usr/bin/env node
// Stable per-checkout ports so parallel worktrees (claude --worktree, git worktree add) never collide.
// The main checkout keeps the documented defaults; linked worktrees get a port derived from their path.
//   node platform/tools/dev-port.mjs        dev server port (default 8080)
//   node platform/tools/dev-port.mjs --e2e  Playwright server port (default 8095)
//   node platform/tools/dev-port.mjs --app core-demo|editor  That app's separate origin; combines with --e2e
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const isBrowserTest = process.argv.includes('--e2e');
const applicationArgumentIndex = process.argv.indexOf('--app');
const application = applicationArgumentIndex === -1 ? 'web' : process.argv[applicationArgumentIndex + 1];
// Separate origins protect internal previews from the public root service worker without deleting caches.
const applicationPortOffsets = {web: 0, 'core-demo': 20000, editor: 30000};
if (!Object.hasOwn(applicationPortOffsets, application)) {
  throw new Error('Choose --app web|core-demo|editor.');
}
let worktreePath = '';
let isLinkedWorktree = false;
try {
  const [toplevel, gitDirectory] = execFileSync('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], {
    encoding: 'utf8'
  }).trim().split('\n');
  worktreePath = toplevel;
  // Linked worktrees use <common>/.git/worktrees/<name>.
  isLinkedWorktree = !gitDirectory.endsWith('/.git');
} catch {
  // Outside a git checkout, retain documented default ports.
}

let port = isBrowserTest ? 8095 : 8080;
if (isLinkedWorktree) {
  const worktreeDigest = crypto.createHash('sha256').update(worktreePath).digest('hex');
  const worktreeOffset = parseInt(worktreeDigest.slice(0, 8), 16) % 400;
  const basePort = isBrowserTest ? 9200 : 8200;
  port = basePort + worktreeOffset * 2;
}
// Consumers parse stdout, including Playwright workers that enable FORCE_COLOR.
process.stdout.write(`${port + applicationPortOffsets[application]}\n`);
