import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const dataDirectory = fileURLToPath(new URL('../', import.meta.url));

// The build rewrites canyon rims, which have no measured widths; replay is what brings the reviewed widths back.
test('a relief rebuild replays reviewed corrections after writing the sources', () => {
  const output = execFileSync('make', ['--dry-run', '-C', dataDirectory, 'build-relief'], {encoding: 'utf8'});
  const commands = output.split('\n');
  const buildStep = commands.findIndex(line => line.includes('data/tools/build-relief.py'));
  const replayStep = commands.findIndex(line => line.includes('data/tools/reapply-corrections.mjs'));
  assert.ok(buildStep >= 0 && replayStep > buildStep, `build-relief must build and then replay:\n${output}`);
});
