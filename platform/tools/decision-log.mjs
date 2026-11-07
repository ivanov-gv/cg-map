// The decisions log is numbered in the order decisions were made, so parallel PRs that take the same number must collide
// here rather than leave two records with one number. See docs/decisions/AGENTS.md.
import fs from 'node:fs';
import path from 'node:path';

const NOT_RECORDS = ['AGENTS.md', 'README.md', 'TEMPLATE.md'];
const RECORD_FILE = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
// Early records say "ADR" and accepted records are not rewritten, so both forms stay valid.
const RECORD_TITLE = /^# (?:ADR )?(\d{4}): \S/;

function titleProblem(file, number, text) {
  const title = text.split('\n')[0];
  const match = title.match(RECORD_TITLE);
  if (!match) return `${file}: the first line must be "# ${number}: <title>", not "${title}"`;
  if (match[1] !== number) return `${file}: its title says ${match[1]}, but its file name says ${number}`;
  return null;
}

// Takes [{file, text}] and returns one message per problem: a bad name or title, a repeated number or a gap.
export function findLogProblems(records) {
  const problems = [];
  const numbered = [];
  for (const {file, text} of records) {
    const match = file.match(RECORD_FILE);
    if (!match) {
      problems.push(`${file}: a record's name must be NNNN-lowercase-words.md`);
      continue;
    }
    numbered.push(match[1]);
    const problem = titleProblem(file, match[1], text);
    if (problem) problems.push(problem);
  }
  numbered.sort();
  numbered.forEach((number, index) => {
    const expected = String(index + 1).padStart(4, '0');
    if (number !== expected) problems.push(`The log must continue with ${expected} at position ${index + 1}, not ${number}`);
  });
  return problems;
}

export function readLog(directory) {
  return fs
    .readdirSync(directory)
    .filter(file => !NOT_RECORDS.includes(file))
    .map(file => ({file, text: fs.readFileSync(path.join(directory, file), 'utf8')}));
}
