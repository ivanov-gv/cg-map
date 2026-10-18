import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const docs = ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'TESTING.md', 'web/README.md', 'web/AGENTS.md', 'source-data/AGENTS.md', ...walk('docs')];
for (const file of docs) {
  assert.ok(file.endsWith('.md'), `docs/ must contain documentation only: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${file}: broken link ${target}`);
  }
}
// Enforce the small runtime dependency graph. New modules need an explicit boundary decision.
const imports = {
  'app.js': ['./core.js', './map-style.js', './satellite.js', './offline.js'],
  'core.js': [], 'map-style.js': [], 'satellite.js': [], 'offline.js': ['./core.js']
};
for (const file of fs.readdirSync('web').filter(f => f.endsWith('.js'))) {
  if (['sw.js', 'offline-manifest.js'].includes(file)) continue;
  assert.ok(Object.hasOwn(imports, file), `Document dependency boundaries for new runtime module ${file} in tools/check-repo.mjs`);
  const text = fs.readFileSync(path.join('web', file), 'utf8');
  assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need an explicit boundary check`);
  for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/g)) {
    assert.ok(imports[file].includes(match[1]), `${file}: forbidden dependency ${match[1]}. Keep pure modules independent of UI and build tools.`);
  }
}
console.log('Documentation links, docs-only layout, and browser module boundaries passed.');

// Root contains project entry/configuration only; runtime assets live in web/.
const rootFiles = new Set(['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'TESTING.md',
  'DATA_LICENSE.md', 'LICENSE', 'Makefile', 'go.mod', 'go.sum', 'package.json',
  'package-lock.json', 'eslint.config.mjs', 'playwright.config.mjs', 'index.html', 'sw.js']);
for (const entry of fs.readdirSync('.', {withFileTypes: true})) {
  if (entry.isFile() && !entry.name.startsWith('.')) assert.ok(rootFiles.has(entry.name),
    `Root clutter: ${entry.name}. Put application assets in web/, Go commands in cmd/, or utilities in tools/.`);
}
assert.ok(!fs.existsSync('.pages-manifest.json'), 'Remove obsolete root asset inventory');
for (const old of ['server.py', 'main.go', 'data', 'fonts', 'vendor']) assert.ok(!fs.existsSync(old), `Obsolete root layout: ${old}`);
