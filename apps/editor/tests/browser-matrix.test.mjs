import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {browserMatrix, readJobCount} from '../tools/browser-matrix.mjs';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const matrixTool = fileURLToPath(new URL('../tools/browser-matrix.mjs', import.meta.url));

test('the browser suite runs as one job per shard', () => {
  assert.deepEqual(browserMatrix(10).include, Array.from({length: 10}, (_, index) => ({shard: index + 1, jobs: 10})));
});

test('a smoke run proves the browser job with only the first shard', () => {
  assert.deepEqual(browserMatrix(10, {smoke: true}).include, [{shard: 1, jobs: 10}]);
});

test('an unusable job count fails instead of hiding a broken configuration', () => {
  for (const jobCount of [0, -1, 1.5, '10', undefined]) {
    assert.throws(() => browserMatrix(jobCount), /positive integer/, String(jobCount));
  }
});

test('the app file holds only the job count', () => {
  const configuration = JSON.parse(fs.readFileSync(new URL('../browser-jobs.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(configuration), ['jobs']);
  assert.equal(readJobCount(), configuration.jobs);
  assert.ok(Number.isInteger(configuration.jobs) && configuration.jobs > 0);
});

test('the command reads the app file for a full run and a smoke run', () => {
  const read = argument => JSON.parse(execFileSync(process.execPath, [matrixTool, ...argument], {
    cwd: applicationRoot,
    encoding: 'utf8'
  }));
  assert.deepEqual(read([]), browserMatrix(readJobCount()));
  assert.deepEqual(read(['--smoke']), browserMatrix(readJobCount(), {smoke: true}));
});
