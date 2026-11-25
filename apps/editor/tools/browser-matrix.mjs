#!/usr/bin/env node
// Builds the editor's browser matrix from its own job count. Playwright shards by test, so a new spec needs no entry.
// CI uses --smoke for a test run: one shard proves the workflow without doubling the PR's browser jobs.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const configuration = new URL('../browser-jobs.json', import.meta.url);

// Reads the one number this app owns and rejects a source that grew into an area list. A source is a file path or the
// parsed object itself, so tests can pass a broken configuration without writing a temporary file.
export function readJobCount(source = configuration) {
  const parsed = typeof source === 'string' || source instanceof URL ? JSON.parse(fs.readFileSync(source, 'utf8')) : source;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).join() !== 'jobs') {
    throw new Error('browser-jobs.json must hold only jobs');
  }
  return parsed.jobs;
}

// Returns one job per requested shard, or only the first when smoke is true.
export function browserMatrix(source, {smoke = false} = {}) {
  const jobCount = readJobCount(source);
  if (!Number.isInteger(jobCount) || jobCount < 1) throw new Error('browser jobs must be a positive integer');
  const shards = smoke ? [1] : Array.from({length: jobCount}, (_, index) => index + 1);
  return {include: shards.map(shard => ({shard, jobs: jobCount}))};
}

function main(args) {
  const smoke = args.includes('--smoke');
  console.log(JSON.stringify(browserMatrix(configuration, {smoke})));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
