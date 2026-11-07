import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {findLogProblems, readLog} from './decision-log.mjs';

function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
function walkDirectories(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).flatMap(e => {
    const child = path.join(dir, e.name);
    return [child, ...walkDirectories(child)];
  });
}
const docsTree = walk('docs');
for (const file of docsTree) {
  assert.ok(file.endsWith('.md'), `docs/ must contain Markdown only: ${file}`);
}
for (const name of ['README.md', 'AGENTS.md']) {
  assert.ok(fs.existsSync(path.join('docs', name)), `docs/ must contain ${name}`);
}
const docsRoot = fs.readdirSync('docs', {withFileTypes: true});
for (const entry of docsRoot) {
  assert.ok(entry.isDirectory() || ['README.md', 'AGENTS.md'].includes(entry.name), `docs/ root only allows README.md, AGENTS.md, and topic folders: ${entry.name}`);
}
for (const dir of ['docs', ...walkDirectories('docs')]) {
  for (const name of ['README.md', 'AGENTS.md']) {
    assert.ok(fs.existsSync(path.join(dir, name)), `${dir}/ must contain ${name}`);
  }
}
const docs = ['README.md', 'AGENTS.md',
  ...['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts', 'packages/map-core', 'apps/core-demo', 'apps/editor', 'tests'].flatMap(dir => ['README.md', 'AGENTS.md'].map(name => `${dir}/${name}`)),
  ...docsTree.filter(file => file.endsWith('.md'))];
for (const file of docs) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), target)), `${file}: broken link ${target}`);
  }
}
// Import lists may span lines, so the clause between the keyword and `from` must accept newlines.
const moduleDependencyPattern = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const imports = {
  'app-updates.js': [],
  'object-selection.js': [],
  'app.js': [
    '@ivanov-gv/map-core',
    './core.js',
    './app-updates.js',
    './data-mode.js',
    './dom.js',
    './interface.js',
    './map-taps.js',
    './object-selection.js',
    './offline.js',
    './offline-panel.js',
    './place-card.js',
    './point-selection.js',
    './position.js',
    './public-layers.js',
    './route-planner.js',
    './status-text.js',
    './tap-targets.js',
    './transport.js'
  ],
  'dom.js': [],
  'interface.js': [],
  'core.js': [],
  'offline.js': ['./core.js'],
  'offline-panel.js': ['./data-mode.js', './dom.js', './offline.js'],
  'place-card.js': ['@ivanov-gv/map-core', './core.js', './dom.js'],
  'public-layers.js': ['@ivanov-gv/map-core', './core.js'],
  'status-text.js': ['./core.js'],
  'tap-targets.js': ['@ivanov-gv/map-core', './point-selection.js'],
  'transport.js': ['./vehicle-direction.js', './data-mode.js'],
  'vehicle-direction.js': [],
  'data-mode.js': [],
  'point-selection.js': [],
  'map-taps.js': [],
  'position.js': ['./core.js'],
  'routing.js': [],
  'transit-routing.js': ['./core.js'],
  'route-planner.js': ['./routing.js', './transit-routing.js', './core.js', './dom.js']
};
for (const file of fs.readdirSync('apps/web/src').filter(file => file.endsWith('.js'))) {
  if (file === 'sw.js') continue;
  assert.ok(Object.hasOwn(imports, file), `Document boundaries for new web module ${file} in platform/tools/check-repo.mjs`);
  const text = fs.readFileSync(path.join('apps/web/src', file), 'utf8');
  assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need an explicit boundary check`);
  for (const match of text.matchAll(moduleDependencyPattern)) {
    assert.ok(imports[file].includes(match[1]), `${file}: forbidden dependency ${match[1]}. Consume published data/contracts, not pipeline or server code.`);
  }
}
for (const file of walk('data/tools').filter(file => file.endsWith('.mjs'))) {
  assert.ok(!/from\s*['"][^'"]*(?:apps\/web|services\/backend)/.test(fs.readFileSync(file, 'utf8')), `${file}: data pipelines must not import application implementation`);
}
const rootFiles = new Set(['README.md', 'AGENTS.md', 'LICENSE', 'Makefile', 'package.json', 'package-lock.json', 'eslint.config.mjs']);
for (const entry of fs.readdirSync('.', {withFileTypes: true})) {
  if (entry.isFile() && !entry.name.startsWith('.')) assert.ok(rootFiles.has(entry.name), `Root clutter: ${entry.name}. Put code under its owning component.`);
}
for (const old of ['web', 'source-data', 'cmd', 'tools', 'deployment', 'go.mod', 'index.html', 'sw.js', '.pages-manifest.json']) {
  assert.ok(!fs.existsSync(old), `Obsolete layout: ${old}`);
}
for (const component of ['apps/web', 'services/backend', 'services/transit-relay', 'data', 'platform', 'packages/contracts', 'packages/map-core', 'apps/core-demo', 'apps/editor', 'tests']) {
  assert.ok(fs.existsSync(`${component}/AGENTS.md`), `Missing component instructions: ${component}`);
}

// Keep shared runtime independent, and keep the concept consumer honest about its public-only imports.
for (const component of ['packages/map-core', 'apps/core-demo', 'apps/editor']) {
  for (const file of walk(`${component}/src`).filter(file => file.endsWith('.js'))) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/\bimport\s*\(/.test(text), `${file}: dynamic imports need a declared boundary`);
    for (const match of text.matchAll(moduleDependencyPattern)) {
      const dependency = match[1];
      const isCoreEntry = dependency === '@ivanov-gv/map-core';
      const isSibling = /^\.\/[^/]+\.js$/.test(dependency);
      const allowedByComponent = {
        'apps/core-demo': isCoreEntry,
        'packages/map-core': isSibling,
        'apps/editor': isCoreEntry || isSibling
      };
      const isAllowed = allowedByComponent[component];
      assert.ok(isAllowed, `${file}: forbidden dependency ${dependency}`);
    }
  }
}
assert.deepEqual(findLogProblems(readLog('docs/decisions')), [], 'The decisions log is out of sequence');
console.log('Documentation links, decisions log, component layout, and dependency boundaries passed.');
