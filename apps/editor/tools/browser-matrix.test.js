import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {browserMatrix, readJobCount} from './browser-matrix.mjs';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const matrixTool = fileURLToPath(new URL('./browser-matrix.mjs', import.meta.url));
const configurationFile = fileURLToPath(new URL('../browser-jobs.json', import.meta.url));

// The tool reads files only, so each case writes its configuration in the worktree and removes it afterwards.
function temporaryConfiguration(testContext, name, contents) {
  const directory = fs.mkdtempSync(path.join(applicationRoot, '.browser-matrix-'));
  const configuration = path.join(directory, `${name}.json`);
  fs.writeFileSync(configuration, JSON.stringify(contents));
  testContext.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return configuration;
}

test('the browser suite runs as one job per shard', testContext => {
  const configuration = temporaryConfiguration(testContext, 'ten-jobs', {jobs: 10});
  assert.deepEqual(
    browserMatrix(configuration).include,
    Array.from({length: 10}, (_, index) => ({shard: index + 1, jobs: 10}))
  );
});

test('a smoke run proves the browser job with only the first shard', testContext => {
  const configuration = temporaryConfiguration(testContext, 'ten-jobs', {jobs: 10});
  assert.deepEqual(browserMatrix(configuration, {smoke: true}).include, [{shard: 1, jobs: 10}]);
});

test('an unusable job count fails instead of hiding a broken configuration', testContext => {
  const configuration = temporaryConfiguration(testContext, 'jobs', {jobs: 1});
  for (const jobCount of [0, -1, 1.5, '10', null]) {
    fs.writeFileSync(configuration, JSON.stringify({jobs: jobCount}));
    assert.throws(() => browserMatrix(configuration), /positive integer/, String(jobCount));
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
  assert.deepEqual(read([]), browserMatrix(configurationFile));
  assert.deepEqual(read(['--smoke']), browserMatrix(configurationFile, {smoke: true}));
});

test('the matrix rejects an extra, missing or empty job configuration', testContext => {
  for (const [name, contents] of [['extra', {jobs: 2, area: 'viewer'}], ['missing', {}], ['empty', null]]) {
    const configuration = temporaryConfiguration(testContext, name, contents);
    assert.throws(() => browserMatrix(configuration), /only jobs/, name);
  }
});
