import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const docs = ['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'TESTING.md',
  ...['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts'].flatMap(dir => ['README.md', 'AGENTS.md'].map(name => `${dir}/${name}`)), ...walk('docs')];
for (const file of docs) {
  assert.ok(file.endsWith('.md'), `docs/ must contain documentation only: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${file}: broken link ${target}`);
  }
}
const imports = {
  'app-updates.js': [],
  'app.js': ['./app-updates.js', './core.js', './map-style.js', './satellite.js', './offline.js', './transport.js', './point-selection.js', './route-planner.js', './map-taps.js'],
  'core.js': [], 'map-style.js': [], 'satellite.js': [], 'offline.js': ['./core.js'], 'transport.js': [], 'point-selection.js': [], 'map-taps.js': [], 'routing.js': [], 'transit-routing.js': ['./core.js'], 'route-planner.js': ['./routing.js', './transit-routing.js', './core.js']
};
for (const file of fs.readdirSync('apps/web/src').filter(file => file.endsWith('.js'))) {
  if (file === 'sw.js') continue;
  assert.ok(Object.hasOwn(imports, file), `Document boundaries for new web module ${file} in platform/tools/check-repo.mjs`);
  const text = fs.readFileSync(path.join('apps/web/src', file), 'utf8');
  assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need an explicit boundary check`);
  for (const match of text.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?['"]([^'"]+)['"]/g)) {
    assert.ok(imports[file].includes(match[1]), `${file}: forbidden dependency ${match[1]}. Consume published data/contracts, not pipeline or server code.`);
  }
}
for (const file of walk('data/tools').filter(file => file.endsWith('.mjs'))) {
  assert.ok(!/from\s*['"][^'"]*(?:apps\/web|services\/backend)/.test(fs.readFileSync(file, 'utf8')), `${file}: data pipelines must not import application implementation`);
}
const rootFiles = new Set(['README.md', 'AGENTS.md', 'ARCHITECTURE.md', 'TESTING.md',
  'DATA_LICENSE.md', 'LICENSE', 'Makefile', 'package.json', 'package-lock.json', 'eslint.config.mjs', 'playwright.config.mjs']);
for (const entry of fs.readdirSync('.', {withFileTypes: true})) {
  if (entry.isFile() && !entry.name.startsWith('.')) assert.ok(rootFiles.has(entry.name), `Root clutter: ${entry.name}. Put code under its owning component.`);
}
for (const old of ['web', 'source-data', 'cmd', 'tools', 'deployment', 'go.mod', 'index.html', 'sw.js', '.pages-manifest.json']) {
  assert.ok(!fs.existsSync(old), `Obsolete layout: ${old}`);
}
for (const component of ['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts']) {
  assert.ok(fs.existsSync(`${component}/AGENTS.md`), `Missing component instructions: ${component}`);
}
console.log('Documentation links, component layout, and dependency boundaries passed.');
