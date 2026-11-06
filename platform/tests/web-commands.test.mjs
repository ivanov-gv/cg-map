import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {repoRoot} from '../agents/lib.mjs';

test('worktree port selection stays machine-readable in color-enabled browser workers', () => {
  for (const args of [[], ['--e2e'], ['--app', 'core-demo'], ['--app', 'editor'], ['--e2e', '--app', 'editor']]) {
    const result = spawnSync(process.execPath, [path.join(repoRoot, 'platform/tools/dev-port.mjs'), ...args], {
      cwd: path.join(repoRoot, 'apps/web'), encoding: 'utf8', env: {...process.env, FORCE_COLOR: '1'}
    });
    assert.equal(result.status, 0, `${result.error ?? ''}${result.stderr}`);
    assert.match(result.stdout, /^\d+\n$/);
    const port = Number(result.stdout);
    assert.ok(port > 0 && port < 65536);
  }
});

test('internal preview ports use distinct origins outside public and browser-test ranges', () => {
  const portTool = path.join(repoRoot, 'platform/tools/dev-port.mjs');
  const ports = [[], ['--e2e'], ['--app', 'core-demo'], ['--app', 'editor']].map(argumentsList => {
    const result = spawnSync(process.execPath, [portTool, ...argumentsList], {cwd: repoRoot, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return Number(result.stdout);
  });
  assert.equal(new Set(ports).size, 4);
  assert.equal(ports[2] - ports[0], 20000);
  assert.equal(ports[3] - ports[0], 30000);
});
