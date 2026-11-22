import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const contractsRoot = path.join(repositoryRoot, 'packages/contracts');
const manifest = JSON.parse(fs.readFileSync(path.join(contractsRoot, 'package.json'), 'utf8'));

// Consumers resolve these names from the installed package, so a missing export fails at their import site.
function publishedFiles() {
  const topLevel = fs
    .readdirSync(contractsRoot)
    .filter(name => name.endsWith('.json') && name !== 'package.json')
    .map(name => `./${name}`);
  const nested = (directory, extension) =>
    fs
      .readdirSync(path.join(contractsRoot, directory), {withFileTypes: true})
      .flatMap(entry =>
        entry.isDirectory()
          ? nested(`${directory}/${entry.name}`, extension)
          : entry.name.endsWith(extension)
            ? [`./${directory}/${entry.name}`]
            : []
      );
  return [...topLevel, ...nested('fixtures', '.json'), ...nested('proto', '.proto')].sort();
}

function packedFilenames() {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json', './packages/contracts'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  return new Set(JSON.parse(output)[0].files.map(entry => entry.path));
}

test('every published contract file is exported and packed', () => {
  const expected = publishedFiles();
  assert.ok(expected.length > 0, 'the package must ship contracts');
  const packed = packedFilenames();
  for (const exported of expected) {
    assert.ok(packed.has(exported.slice(2)), `npm pack must include ${exported}`);
    const resolved = import.meta.resolve(`${manifest.name}${exported.slice(1)}`);
    assert.ok(resolved.endsWith(`packages/contracts/${exported.slice(2)}`), `${exported} must resolve through the package export`);
  }
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.repository.directory, 'packages/contracts');
  assert.equal(manifest.publishConfig.registry, 'https://npm.pkg.github.com');
  assert.equal(manifest.version, '0.0.0-dev', 'the repository version must never satisfy a release pin');
});
