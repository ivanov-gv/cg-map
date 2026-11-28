import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFixtureProject, runFixtureTool} from './fixture-project.mjs';

test('build keeps nested source paths, local imports and asset strings, and excludes tests and support files', async testContext => {
  const fixture = createFixtureProject(testContext);
  const result = runFixtureTool(fixture, 'build.mjs');
  assert.equal(result.status, 0, `${result.stdout ?? ''}${result.stderr ?? ''}`);

  const nestedModule = path.join(fixture.output, 'shared/feature/nested.js');
  assert.ok(fs.existsSync(nestedModule), 'nested runtime module must keep its source path');
  assert.equal(
    fs.readFileSync(nestedModule, 'utf8'),
    [
      "import '../../map-core/index.js';",
      "import {localHelper} from './map-core/helper.js';",
      'export const featureValue = 1;',
      "export const localIconPath = './map-core/icon.svg';",
      'export {localHelper};',
      ''
    ].join('\n')
  );
  const builtNested = await import(pathToFileURL(nestedModule).href);
  assert.equal(builtNested.featureValue, 1);
  assert.equal(builtNested.localIconPath, './map-core/icon.svg');
  assert.equal(builtNested.localHelper, 'feature-local');
  assert.ok(fs.existsSync(path.join(fixture.output, 'shared/feature/map-core/icon.svg')));
  assert.equal(
    fs.readFileSync(path.join(fixture.output, 'app.js'), 'utf8'),
    "import {featureValue} from './shared/feature/nested.js';\nexport {featureValue};\n"
  );
  assert.ok(!fs.existsSync(path.join(fixture.output, 'shared/feature/nested.test.js')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'shared/feature/nested.browser.test.js')));
  assert.ok(!fs.existsSync(path.join(fixture.output, 'test-support')));
});
