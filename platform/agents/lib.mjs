// Shared helpers for the agent adapter generator and its tests. Standard library only: the git
// pre-commit hook runs the generator before `make setup` has installed npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadConfig(root = repoRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, 'platform/agents/guidelines.json'), 'utf8'));
}

export function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
}

// Minimal glob support for the patterns used in guidelines.json: `**/`, `**`, `*`, `?`.
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function guidelinesForPath(config, file) {
  const rel = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return config.guidelines.filter(g => g.paths.some(p => globToRegExp(p).test(rel)));
}

export function stripTitle(body) {
  const lines = body.split('\n');
  const title = lines[0].startsWith('# ') ? lines.shift().slice(2).trim() : '';
  return {title, rest: lines.join('\n').replace(/^\n+/, '')};
}

// Rewrite relative markdown links so they still resolve from `toFile` (or become repo-relative when toFile is null).
export function rewriteLinks(body, fromFile, toFile) {
  return body.replace(/\]\(([^)]+)\)/g, (whole, target) => {
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) return whole;
    const [file, anchor] = target.split('#');
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), file));
    const rel = toFile ? path.posix.relative(path.posix.dirname(toFile), abs) || '.' : abs;
    return `](${rel}${anchor ? `#${anchor}` : ''})`;
  });
}

export function readGuideline(guideline, root = repoRoot) {
  const text = fs.readFileSync(path.join(root, guideline.source), 'utf8');
  return {text, hash: sha(text)};
}
