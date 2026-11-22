import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const dataRoot = path.join(repositoryRoot, 'data');

// A project's tests read only their own files. tests/integration checks which tools consumers import; this test checks
// that everything data declares or imports itself, including local imports between tools, is actually published.
function collectLocalImports(toolName, collected) {
  if (collected.has(toolName)) return;
  const filename = path.join(dataRoot, 'tools', toolName);
  assert.ok(fs.existsSync(filename), `${filename} must exist for a packaged tool`);
  collected.add(toolName);
  const source = fs.readFileSync(filename, 'utf8');
  const localImportPattern = /(?:from\s+|import\s*\()['"]\.\/([\w.-]+\.mjs)['"]/g;
  for (const match of source.matchAll(localImportPattern)) collectLocalImports(match[1], collected);
}

function requiredTools(manifest) {
  const collected = new Set();
  for (const entry of manifest.files) {
    const match = /^tools\/([\w.-]+\.mjs)$/.exec(entry);
    if (match) collectLocalImports(match[1], collected);
  }
  for (const filename of fs.readdirSync(path.join(dataRoot, 'tests'))) {
    if (!filename.endsWith('.mjs')) continue;
    const source = fs.readFileSync(path.join(dataRoot, 'tests', filename), 'utf8');
    for (const match of source.matchAll(/from\s+['"]\.\.\/tools\/([\w.-]+\.mjs)['"]/g))
      collectLocalImports(match[1], collected);
  }
  assert.ok(collected.size > 0, 'data/package.json must declare packaged tools');
  return [...collected].sort();
}

function packedFilenames() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', '-w', 'data'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  return new Set(JSON.parse(output)[0].files.map(entry => entry.path));
}

test('npm pack ships every declared data tool and its local imports', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataRoot, 'package.json'), 'utf8'));
  const packed = packedFilenames();
  const required = requiredTools(manifest);
  for (const toolName of required) {
    assert.ok(manifest.files.includes(`tools/${toolName}`), `data/package.json files must include tools/${toolName}`);
    assert.ok(manifest.exports[`./tools/${toolName}`], `data/package.json exports must include ./tools/${toolName}`);
    assert.ok(packed.has(`tools/${toolName}`), `npm pack must include tools/${toolName}`);
  }
  const packedTools = [...packed].filter(entry => /^tools\/[\w.-]+\.mjs$/.test(entry)).sort();
  assert.deepEqual(packedTools, required.map(toolName => `tools/${toolName}`), 'npm pack must ship only listed tools');
});
