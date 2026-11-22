import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {dataRoot} from '../data-root.mjs';

// Only tests/ reads other projects at HEAD. It checks that no consumer can import a data tool the package omits;
// data/tests/package-contents.test.mjs checks that the declared tools are actually packed.
const skippedDirectories = new Set(['node_modules', 'dist', '.build']);

function walk(directory) {
  const filenames = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (skippedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) filenames.push(...walk(entryPath));
    else if (entry.name.endsWith('.mjs')) filenames.push(entryPath);
  }
  return filenames;
}

const referencePatterns = [
  /dataToolURL\(\s*['"`]([\w.-]+\.mjs)['"`]\s*\)/g,
  /@ivanov-gv\/map-data\/tools\/([\w.-]+\.mjs)/g,
  /path\.join\(\s*dataRoot\s*,\s*['"`]tools\/([\w.-]+\.mjs)['"`]\s*\)/g
];

function collectLocalImports(toolName, collected) {
  if (collected.has(toolName)) return;
  const filename = path.join(dataRoot, 'tools', toolName);
  assert.ok(fs.existsSync(filename), `${filename} must exist for a tool imported by a consumer`);
  collected.add(toolName);
  const source = fs.readFileSync(filename, 'utf8');
  for (const match of source.matchAll(/(?:from\s+|import\s*\()['"]\.\/([\w.-]+\.mjs)['"]/g))
    collectLocalImports(match[1], collected);
}

function toolsImportedByConsumers() {
  const collected = new Set();
  const directories = [import.meta.dirname, path.join(import.meta.dirname, '../../apps')];
  for (const directory of directories) {
    for (const filename of walk(directory)) {
      const source = fs.readFileSync(filename, 'utf8');
      for (const pattern of referencePatterns) {
        for (const match of source.matchAll(pattern)) collectLocalImports(match[1], collected);
      }
    }
  }
  assert.ok(collected.size > 0, 'the consumer scan must find data tools');
  return [...collected].sort();
}

test('every data tool a consumer imports is published', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'package.json'), 'utf8'));
  for (const toolName of toolsImportedByConsumers()) {
    assert.ok(manifest.files.includes(`tools/${toolName}`), `data/package.json files must include tools/${toolName}`);
    assert.ok(manifest.exports[`./tools/${toolName}`], `data/package.json exports must include ./tools/${toolName}`);
  }
});
