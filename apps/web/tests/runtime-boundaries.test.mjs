import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {assertRuntimeBoundaries} from '../tools/runtime-modules.mjs';
import {createFixtureProject} from './fixture-project.mjs';

test('web boundaries accept a nested runtime module and ignore colocated tests', testContext => {
  const fixture = createFixtureProject(testContext);
  assert.doesNotThrow(() => assertRuntimeBoundaries(fixture.source));
});

test('web boundaries reject a forbidden dependency in a nested runtime module', testContext => {
  const fixture = createFixtureProject(testContext);
  const nestedModule = path.join(fixture.source, 'feature/nested.js');
  fs.writeFileSync(
    nestedModule,
    "import {bad} from '../../../editor/src/core.js';\nexport const nestedValue = bad;\n"
  );
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /forbidden dependency/);
});

test('web boundaries reject dynamic imports and MapLibre gesture handlers', testContext => {
  const fixture = createFixtureProject(testContext);
  const nestedModule = path.join(fixture.source, 'feature/nested.js');
  const allowedSource = fs.readFileSync(nestedModule, 'utf8');
  fs.writeFileSync(nestedModule, `${allowedSource}\nexport const later = () => import('./other.js');\n`);
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /dynamic imports/);

  fs.writeFileSync(nestedModule, `${allowedSource}\nexport const gesture = maplibregl.Map.prototype.scrollZoom;\n`);
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /map gestures stay MapLibre's own/);
});

test('web boundaries reject a runtime import of a test support file', testContext => {
  const fixture = createFixtureProject(testContext);
  const nestedModule = path.join(fixture.source, 'feature/nested.js');
  fs.writeFileSync(nestedModule, "import {helper} from '../test-support/helper.js';\nexport const nestedValue = helper;\n");
  assert.throws(() => assertRuntimeBoundaries(fixture.source), /forbidden dependency/);
});
