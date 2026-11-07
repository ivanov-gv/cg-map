// Agents differ in which instruction files they load on their own: Claude Code reads nested AGENTS.md files by path,
// Codex only those from the root down to its start directory. So every instruction file must be reachable from the root
// AGENTS.md by following relative Markdown links, or some agent never learns it exists.
import fs from 'node:fs';
import path from 'node:path';

const markdownLink = /\]\(([^)#\s]+)/g;

// Relative link targets of one Markdown file, as paths from the repository root. A link to a directory stands for its
// AGENTS.md or README.md.
function linkedFiles(root, file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const targets = [];
  for (const [, target] of text.matchAll(markdownLink)) {
    if (target.includes('://') || target.startsWith('mailto:')) continue;
    const resolved = path.normalize(path.join(path.dirname(file), target));
    const absolute = path.join(root, resolved);
    if (!fs.existsSync(absolute)) continue;
    if (!fs.statSync(absolute).isDirectory()) {
      targets.push(resolved);
      continue;
    }
    for (const name of ['AGENTS.md', 'README.md']) {
      if (fs.existsSync(path.join(absolute, name))) targets.push(path.join(resolved, name));
    }
  }
  return targets;
}

// Every file reachable from start through relative links, following links only out of Markdown files.
export function reachableFiles(root, start = 'AGENTS.md') {
  const reached = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const file = pending.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    if (file.endsWith('.md')) pending.push(...linkedFiles(root, file));
  }
  return reached;
}

// The instruction files no agent could find from the root AGENTS.md, sorted.
export function unreachableInstructions(root, instructionFiles) {
  const reached = reachableFiles(root);
  return instructionFiles.filter(file => !reached.has(file)).sort();
}
