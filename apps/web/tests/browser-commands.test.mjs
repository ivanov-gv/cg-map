import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {stripVTControlCharacters} from 'node:util';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));

function listBrowserTestsDirectly(filters) {
  return spawnSync('npm', ['run', '-s', 'test:e2e:built', '--', ...filters, '--list'], {
    cwd: applicationRoot,
    encoding: 'utf8',
    timeout: 15000
  });
}

function listBrowserTestsThroughMake(makeArguments) {
  return spawnSync('make', ['--no-print-directory', 'e2e-built', `E2E_ARGS=${makeArguments} --list`], {
    cwd: applicationRoot,
    encoding: 'utf8',
    timeout: 15000
  });
}

test('the Makefile preserves project, title and file filters', async t => {
  const cases = [
    {
      name: 'mobile transport',
      filters: ['--project=pages-mobile', '--grep=transport toggles'],
      makeArguments: "--project=pages-mobile --grep='transport toggles'",
      count: 1
    },
    {
      name: 'update journey file',
      filters: ['tests/e2e/updates.spec.mjs'],
      makeArguments: 'tests/e2e/updates.spec.mjs',
      count: 2
    }
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const results = [listBrowserTestsThroughMake(scenario.makeArguments), listBrowserTestsDirectly(scenario.filters)];
      const selections = results.map(result => {
        assert.equal(result.status, 0, `${result.error ?? ''}${result.stdout}${result.stderr}`);
        const output = stripVTControlCharacters(result.stdout);
        const entries = output.split('\n').filter(line => /^\s+\[(root-desktop|pages-mobile)\]/.test(line));
        assert.equal(entries.length, scenario.count, output);
        return entries;
      });
      assert.deepEqual(selections[0], selections[1]);
    });
  }
});

test('the Makefile returns failure when the requested scenario does not exist', () => {
  const result = listBrowserTestsThroughMake('--grep=__missing_web_ownership_scenario__');
  assert.notEqual(result.status, 0, `${result.error ?? ''}${result.stdout}${result.stderr}`);
  assert.match(stripVTControlCharacters(result.stdout + result.stderr), /No tests found/);
});
