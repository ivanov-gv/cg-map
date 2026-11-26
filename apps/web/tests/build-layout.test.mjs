import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createFixtureProject, runFixtureTool} from './fixture-project.mjs';

test('build keeps nested source paths and excludes tests and support files', testContext => {
  const fixture = createFixtureProject(testContext);
  const result = runFixtureTool(fixture, 'build.mjs');
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);

  const nestedModule = path.join(fixture.output, 'feature/nested.js');
  assert.ok(fs.existsSync(nestedModule), 'nested runtime module must keep its source path');
  assert.equal(
    fs.readFileSync(nestedModule, 'utf8'),
    "import '../map-core/index.js';\nexport const featureValue = 1;\n"
  );
  assert.equal(
    fs.readFileSync(path.join(fixture.output, 'app.js'), 'utf8'),
    "import {featureValue} from './feature/nested.js';\nexport {featureValue};\n"
  );
  assert.ok(!fs.existsSync(path.join(fixture.output, 'feature/nested.test.js')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'feature/nested.browser.test.js')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'test-support')));
});
