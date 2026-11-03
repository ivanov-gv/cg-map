import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {stripVTControlCharacters} from 'node:util';
import {repoRoot} from '../agents/lib.mjs';

function listBrowserTests(cwd, filters) {
  return spawnSync('npm', ['run', '-s', 'test:e2e:built', '--', ...filters, '--list'], {
    cwd, encoding: 'utf8', timeout: 15000
  });
}

test('worktree port selection stays machine-readable in color-enabled browser workers', () => {
  for (const args of [[], ['--e2e']]) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'platform/tools/dev-port.mjs'), ...args], {
      cwd: path.join(repoRoot, 'apps/web'), encoding: 'utf8', env: {...process.env, FORCE_COLOR: '1'}
    });
    assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
    assert.match(result.stdout, /^\d+\n$/);
    const port = Number(result.stdout);
    assert.ok(port > 0 && port < 65536);
  }
});

test('root browser forwarding preserves project, title and file filters from the web workspace', async t => {
  const cases = [
    {name: 'mobile transport', filters: ['--project=pages-mobile', '--grep=transport toggles'], count: 1},
    {name: 'update journey file', filters: ['tests/e2e/updates.spec.mjs'], count: 2}
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const results = [repoRoot, path.join(repoRoot, 'apps/web')].map(cwd => listBrowserTests(cwd, scenario.filters));
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

test('root browser forwarding returns failure when the requested scenario does not exist', () => {
  const result = listBrowserTests(repoRoot, ['--grep=__missing_web_ownership_scenario__']);
  assert.equal(result.status, 1, `${result.error ?? ''}${result.stdout}${result.stderr}`);
  assert.match(stripVTControlCharacters(result.stdout + result.stderr), /No tests found/);
});
