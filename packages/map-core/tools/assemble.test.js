import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assembleStaticApplication, relocateCoreImports} from './assemble.mjs';

test('imports of this package are rewritten to the copy inside an artifact, and nothing else is', () => {
  const source = [
    "import {createMap} from '@ivanov-gv/map-core';",
    "import {mapStyle} from '@ivanov-gv/map-core/src/map-style.js';",
    "import {other} from '@ivanov-gv/map-core-extras';",
    "import {local} from './local.js';"
  ].join('\n');
  assert.deepEqual(relocateCoreImports(source).split('\n'), [
    "import {createMap} from './map-core/index.js';",
    "import {mapStyle} from './map-core/map-style.js';",
    "import {other} from '@ivanov-gv/map-core-extras';",
    "import {local} from './local.js';"
  ]);
});

test('artifact assembly copies runtime modules but no tests next to them', t => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'map-core-assembly-'));
  t.after(() => fs.rmSync(temporaryDirectory, {recursive: true, force: true}));
  const applicationDirectory = path.join(temporaryDirectory, 'application');
  const artifactDirectory = path.join(temporaryDirectory, 'artifact');
  fs.mkdirSync(path.join(applicationDirectory, 'public'), {recursive: true});
  fs.mkdirSync(path.join(applicationDirectory, 'src'), {recursive: true});
  fs.writeFileSync(path.join(applicationDirectory, 'public', 'index.html'), '<html></html>');
  fs.writeFileSync(
    path.join(applicationDirectory, 'src', 'app.js'),
    "import {createMap} from '@ivanov-gv/map-core';\n"
  );
  fs.writeFileSync(path.join(applicationDirectory, 'src', 'app.test.js'), "import test from 'node:test';\n");

  assembleStaticApplication(applicationDirectory, artifactDirectory);

  assert.ok(fs.existsSync(path.join(artifactDirectory, 'app.js')));
  assert.ok(fs.existsSync(path.join(artifactDirectory, 'map-core', 'map.js')));
  const copiedTests = fs
    .readdirSync(artifactDirectory, {recursive: true})
    .filter(entry => typeof entry === 'string' && entry.endsWith('.test.js'));
  assert.deepEqual(copiedTests, []);
});
