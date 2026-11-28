import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRuntimeBoundaries, findRuntimeModules, readLocalDependencies} from '../tools/runtime-modules.mjs';
import {createFixtureProject} from './fixture-project.mjs';

test('web boundaries accept a new runtime module and ignore colocated tests', testContext => {
  const fixture = createFixtureProject(testContext);
  assert.doesNotThrow(() => assertRuntimeBoundaries(fixture.source));
});

test('web boundaries keep main reviewed imports and shared/core.js has no local imports', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.writeFileSync(
    path.join(fixture.source, 'offline/offline.js'),
    "import {elementById} from '../shared/dom.js';\n"
  );
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /main's reviewed import graph/);

  const appSource = fileURLToPath(new URL('../src/', import.meta.url));
  assert.doesNotThrow(() => assertRuntimeBoundaries(appSource));
  assert.deepEqual(readLocalDependencies(path.join(appSource, 'shared/core.js')), []);
});

test('web boundaries reject a transitive bypass through a new module', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.writeFileSync(
    path.join(fixture.source, 'offline/helper.js'),
    "import {elementById} from '../shared/dom.js';\nexport {elementById};\n"
  );
  fs.writeFileSync(
    path.join(fixture.source, 'offline/offline.js'),
    "import {elementById} from './helper.js';\nexport {elementById};\n"
  );
  assert.throws(
    () => assertRuntimeBoundaries(fixture.source),
    /offline\/offline\.js: transitive imports reach main modules outside its reviewed graph \(shared\/dom\.js\)/
  );
});

test('web boundaries fail when a reviewed module moves without its rule', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.mkdirSync(path.join(fixture.source, 'x'), {recursive: true});
  fs.renameSync(path.join(fixture.source, 'shared/core.js'), path.join(fixture.source, 'x/core.js'));
  assert.throws(
    () => assertRuntimeBoundaries(fixture.source),
    /shared\/core\.js: reviewed module missing from src\. Move its rule into this file's per-folder rules\./
  );
});

test('web boundaries keep zero-import modules free of new local imports', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.mkdirSync(path.join(fixture.source, 'x'), {recursive: true});
  fs.writeFileSync(path.join(fixture.source, 'x/added.js'), 'export const added = true;\n');
  for (const moduleName of ['shared/core.js', 'shared/dom.js']) {
    fs.writeFileSync(
      path.join(fixture.source, moduleName),
      "import {added} from '../../x/added.js';\nexport {added};\n"
    );
  }
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /may not import \.\.\/\.\.\/x\/added\.js/);
});

test('web boundaries reject a forbidden dependency in a new runtime module', testContext => {
  const fixture = createFixtureProject(testContext);
  const newModule = path.join(fixture.source, 'feature/nested.js');
  fs.writeFileSync(
    newModule,
    "import {bad} from '../../../../editor/src/layers/shared/editor-layers.js';\nexport const nestedValue = bad;\n"
  );
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /forbidden dependency/);
});

test('web boundaries reject imports outside allowed feature folders', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.writeFileSync(path.join(fixture.source, 'map/added.js'), 'export const added = true;\n');
  fs.writeFileSync(
    path.join(fixture.source, 'offline/offline.js'),
    "import {added} from '../map/added.js';\nexport {added};\n"
  );
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /Feature folders may import only their allowed folders/);
});

test('web boundaries reject dynamic imports and MapLibre gesture handlers', testContext => {
  const fixture = createFixtureProject(testContext);
  const newModule = path.join(fixture.source, 'feature/nested.js');
  const allowedSource = fs.readFileSync(newModule, 'utf8');
  fs.writeFileSync(newModule, `${allowedSource}\nexport const later = () => import('./other.js');\n`);
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /dynamic imports/);

  fs.writeFileSync(newModule, `${allowedSource}\nexport const gesture = maplibregl.Map.prototype.scrollZoom;\n`);
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /map gestures stay MapLibre's own/);
});

test('web boundaries reject a runtime import of a test support file', testContext => {
  const fixture = createFixtureProject(testContext);
  const newModule = path.join(fixture.source, 'feature/nested.js');
  fs.writeFileSync(newModule, "import {helper} from '../test-support/helper.js';\nexport const nestedValue = helper;\n");
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /forbidden dependency/);
});

test('runtime module discovery returns sorted paths regardless of walk order', testContext => {
  const fixture = createFixtureProject(testContext);
  fs.mkdirSync(path.join(fixture.source, 'a'), {recursive: true});
  fs.writeFileSync(path.join(fixture.source, 'A.js'), 'export const upper = true;\n');
  fs.writeFileSync(path.join(fixture.source, 'a.js'), 'export const lower = true;\n');
  fs.writeFileSync(path.join(fixture.source, 'a/z.js'), 'export const z = true;\n');
  fs.writeFileSync(path.join(fixture.source, 'b.js'), 'export const b = true;\n');

  const modules = findRuntimeModules(fixture.source);
  assert.equal(modules[0], 'A.js');
  assert.ok(modules.indexOf('a.js') < modules.indexOf('a/z.js'));
  assert.deepEqual(modules, [...modules].sort());
});
