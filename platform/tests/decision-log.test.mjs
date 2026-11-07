import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {findLogProblems, readLog} from '../tools/decision-log.mjs';
import {repoRoot} from '../agents/lib.mjs';

const record = (number, slug = 'a-choice') => ({file: `${number}-${slug}.md`, text: `# ${number}: A choice\n`});

test('the repository log is in sequence', () => {
  assert.deepEqual(findLogProblems(readLog(path.join(repoRoot, 'docs/decisions'))), []);
});

test('an unbroken sequence passes, including the older title form', () => {
  const older = {file: '0001-first.md', text: '# ADR 0001: First\n'};
  assert.deepEqual(findLogProblems([older, record('0002'), record('0003')]), []);
});

test('a gap fails', () => {
  assert.match(findLogProblems([record('0001'), record('0003')]).join(), /continue with 0002/);
});

test('a missing first record fails', () => {
  assert.match(findLogProblems([record('0002')]).join(), /continue with 0001/);
});

test('two records with one number fail, as when parallel PRs both take the next number', () => {
  const problems = findLogProblems([record('0001'), record('0002', 'one'), record('0002', 'other')]);
  assert.match(problems.join(), /continue with 0003/);
});

test('a badly named record fails rather than being ignored', () => {
  assert.match(findLogProblems([{file: 'choice.md', text: '# Choice\n'}]).join(), /NNNN-lowercase-words/);
});

test('a title that disagrees with its file name fails', () => {
  const problems = findLogProblems([{file: '0001-first.md', text: '# 0002: First\n'}]);
  assert.match(problems.join(), /title says 0002/);
});

test('a record without a numbered title fails', () => {
  assert.match(findLogProblems([{file: '0001-first.md', text: '# First\n'}]).join(), /first line must be/);
});
