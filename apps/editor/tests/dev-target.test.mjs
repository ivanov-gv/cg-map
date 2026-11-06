import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const portTool = fileURLToPath(new URL('../../../platform/tools/dev-port.mjs', import.meta.url));

// The preview must stay on its own origin, outside the public app's service worker.
test("make dev serves this artifact on this app's own port", () => {
  const port = spawnSync(process.execPath, [portTool, '--app', 'editor'], {encoding: 'utf8'}).stdout.trim();
  const environment = {...process.env};
  delete environment.PORT;
  const preview = spawnSync('make', ['--no-print-directory', '-n', 'dev'], {
    cwd: applicationRoot,
    encoding: 'utf8',
    env: environment
  });
  assert.equal(preview.status, 0, preview.stderr);
  assert.ok(preview.stdout.includes(`--port ${port} --app editor`), preview.stdout);
});
