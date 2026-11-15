import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  getApprovalCompletedAt,
  getEarliestStartedAt,
  laterOf,
  getEffectiveStart,
  parseTimestamp,
  computeElapsedSeconds,
  getVerdict,
  buildSummary,
  evaluateRunBudget
} from '../tools/run-budget.mjs';

const execFileAsync = promisify(execFile);
const scriptPath = path.join(new URL('.', import.meta.url).pathname, '../tools/run-budget.mjs');

const APPROVAL_NAME = 'Approve CI run';

// Helper: build a minimal jobs array with an approval job
function makeJobsWithApproval(completedAt) {
  return [{name: APPROVAL_NAME, completed_at: completedAt}];
}

// Helper: build a jobs array without an approval job
function makeJobsWithoutApproval() {
  return [{name: 'Some other job', started_at: '2024-01-01T00:00:30Z', completed_at: '2024-01-01T00:01:00Z'}];
}

// Helper: build a full API response object
function makeApiResponse(jobs) {
  return {jobs};
}

const AIM = 300;
const LIMIT = 420;

// --- getApprovalCompletedAt ---

test('getApprovalCompletedAt returns the approval job timestamp', () => {
  const jobs = makeJobsWithApproval('2024-06-01T10:05:00Z');
  assert.equal(getApprovalCompletedAt(jobs, APPROVAL_NAME), '2024-06-01T10:05:00Z');
});

test('getApprovalCompletedAt returns null when no approval job', () => {
  const jobs = makeJobsWithoutApproval();
  assert.equal(getApprovalCompletedAt(jobs, APPROVAL_NAME), null);
});

// --- laterOf ---

test('laterOf returns the later of two timestamps', () => {
  assert.equal(
    laterOf('2024-06-01T10:00:00Z', '2024-06-01T10:05:00Z'),
    '2024-06-01T10:05:00Z'
  );
});

test('laterOf returns the first when equal', () => {
  assert.equal(
    laterOf('2024-06-01T10:00:00Z', '2024-06-01T10:00:00Z'),
    '2024-06-01T10:00:00Z'
  );
});

test('laterOf returns the non-null value when one is null', () => {
  assert.equal(laterOf(null, '2024-06-01T10:05:00Z'), '2024-06-01T10:05:00Z');
  assert.equal(laterOf('2024-06-01T10:05:00Z', null), '2024-06-01T10:05:00Z');
});

test('laterOf returns null when both are null', () => {
  assert.equal(laterOf(null, null), null);
});

// --- getEffectiveStart ---

test('getEffectiveStart uses approval completed_at when present (no runStartedAt)', () => {
  const jobs = makeJobsWithApproval('2024-06-01T10:05:00Z');
  assert.equal(getEffectiveStart(jobs, APPROVAL_NAME, undefined), '2024-06-01T10:05:00Z');
});

test('getEffectiveStart falls back to earliest job started_at when no approval job (no runStartedAt)', () => {
  const jobs = makeJobsWithoutApproval();
  assert.equal(getEffectiveStart(jobs, APPROVAL_NAME, undefined), '2024-01-01T00:00:30Z');
});

test('getEffectiveStart uses the later of approval and runStartedAt', () => {
  // On a rerun: runStartedAt is after the original approval.
  const jobs = makeJobsWithApproval('2024-06-01T11:43:04Z');
  const runStartedAt = '2024-06-01T12:15:04Z';
  assert.equal(
    getEffectiveStart(jobs, APPROVAL_NAME, runStartedAt),
    '2024-06-01T12:15:04Z',
    'rerun: runStartedAt (12:15:04) is later than approval (11:43:04)'
  );
});

test('getEffectiveStart uses approval when it is later than runStartedAt', () => {
  // On a first run: approval is after the run started.
  const jobs = makeJobsWithApproval('2024-06-01T10:05:00Z');
  const runStartedAt = '2024-06-01T10:00:00Z';
  assert.equal(
    getEffectiveStart(jobs, APPROVAL_NAME, runStartedAt),
    '2024-06-01T10:05:00Z',
    'first run: approval (10:05:00) is later than runStartedAt (10:00:00)'
  );
});

test('getEffectiveStart falls back to approval when runStartedAt is invalid', () => {
  const jobs = makeJobsWithApproval('2024-06-01T10:05:00Z');
  assert.equal(
    getEffectiveStart(jobs, APPROVAL_NAME, 'not-a-date'),
    '2024-06-01T10:05:00Z',
    'invalid runStartedAt falls back to approval'
  );
});

test('getEffectiveStart falls back to earliest job start when runStartedAt is invalid and no approval', () => {
  const jobs = makeJobsWithoutApproval();
  assert.equal(
    getEffectiveStart(jobs, APPROVAL_NAME, 'not-a-date'),
    '2024-01-01T00:00:30Z',
    'invalid runStartedAt with no approval falls back to earliest job start'
  );
});

// Real data: run 43710253591, attempt 2
// Approval completed at 11:43:04Z, attempt started at 12:15:04Z, gate ran at 12:15:17Z.
// Elapsed from attempt start to gate: 13 seconds — must be ok, not fail.
test('getEffectiveStart: real data from run 43710253591 attempt 2', () => {
  const jobs = makeJobsWithApproval('2024-06-01T11:43:04Z');
  const runStartedAt = '2024-06-01T12:15:04Z';
  assert.equal(
    getEffectiveStart(jobs, APPROVAL_NAME, runStartedAt),
    '2024-06-01T12:15:04Z',
    'run 43710253591 attempt 2: runStartedAt is the effective start'
  );
});

// --- getEarliestStartedAt ---

test('getEarliestStartedAt returns the earliest started_at from jobs', () => {
  const jobs = [
    {name: 'A', started_at: '2024-01-01T00:02:00Z'},
    {name: 'B', started_at: '2024-01-01T00:00:00Z'},
    {name: 'C', started_at: '2024-01-01T00:01:00Z'}
  ];
  assert.equal(getEarliestStartedAt(jobs), '2024-01-01T00:00:00Z');
});

test('getEarliestStartedAt returns null when no jobs have started_at', () => {
  const jobs = [{name: 'A', completed_at: '2024-01-01T00:01:00Z'}];
  assert.equal(getEarliestStartedAt(jobs), null);
});

// --- parseTimestamp ---

test('parseTimestamp converts valid ISO to milliseconds', () => {
  assert.equal(parseTimestamp('2024-01-01T00:00:00Z'), Date.parse('2024-01-01T00:00:00Z'));
});

test('parseTimestamp returns null for invalid input', () => {
  assert.equal(parseTimestamp(null), null);
  assert.equal(parseTimestamp(''), null);
  assert.equal(parseTimestamp('not-a-date'), null);
  assert.equal(parseTimestamp(123), null);
});

// --- computeElapsedSeconds ---

test('computeElapsedSeconds returns seconds between two timestamps', () => {
  const start = '2024-01-01T00:00:00Z';
  const end = '2024-01-01T00:05:00Z';
  assert.equal(computeElapsedSeconds(start, end), 300);
});

test('computeElapsedSeconds returns null for invalid timestamps', () => {
  assert.equal(computeElapsedSeconds(null, '2024-01-01T00:05:00Z'), null);
  assert.equal(computeElapsedSeconds('2024-01-01T00:00:00Z', 'bad'), null);
});

// --- getVerdict ---

test('getVerdict returns ok when under the aim', () => {
  assert.equal(getVerdict(200, AIM, LIMIT, 'pull_request'), 'ok');
});

test('getVerdict returns ok at exactly the aim', () => {
  assert.equal(getVerdict(AIM, AIM, LIMIT, 'pull_request'), 'ok');
});

test('getVerdict returns warn between aim and limit', () => {
  assert.equal(getVerdict(360, AIM, LIMIT, 'pull_request'), 'warn');
});

test('getVerdict returns warn at exactly the limit', () => {
  assert.equal(getVerdict(LIMIT, AIM, LIMIT, 'pull_request'), 'warn');
});

test('getVerdict returns fail when over the limit', () => {
  assert.equal(getVerdict(500, AIM, LIMIT, 'pull_request'), 'fail');
});

test('getVerdict returns unreadable when elapsed is null', () => {
  assert.equal(getVerdict(null, AIM, LIMIT, 'pull_request'), 'unreadable');
});

test('getVerdict returns ok for non-pull_request events (exempt)', () => {
  assert.equal(getVerdict(9999, AIM, LIMIT, 'schedule'), 'ok');
  assert.equal(getVerdict(9999, AIM, LIMIT, 'workflow_dispatch'), 'ok');
  assert.equal(getVerdict(9999, AIM, LIMIT, 'workflow_call'), 'ok');
});

// --- buildSummary ---

test('buildSummary shows exempt for non-PR events', () => {
  const summary = buildSummary('ok', 100, AIM, LIMIT, 'schedule');
  assert.match(summary, /exempt/);
  assert.match(summary, /schedule/);
});

test('buildSummary shows unreadable when elapsed is null', () => {
  const summary = buildSummary('unreadable', null, AIM, LIMIT, 'pull_request');
  assert.match(summary, /unreadable/);
});

test('buildSummary shows elapsed and verdict for PR events', () => {
  const summary = buildSummary('warn', 360, AIM, LIMIT, 'pull_request');
  assert.match(summary, /360s elapsed/);
  assert.match(summary, /warn/);
});

// --- evaluateRunBudget (integration) ---

test('evaluateRunBudget: under the aim returns ok', () => {
  // Approval completed 4.5 minutes before now.
  const now = '2024-06-01T10:04:30Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T10:00:00Z'));
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'ok');
  assert.ok(result.elapsedSeconds >= 0);
});

test('evaluateRunBudget: between aim and limit returns warn', () => {
  const now = '2024-06-01T10:06:00Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T10:00:00Z'));
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'warn');
});

test('evaluateRunBudget: over the limit returns fail', () => {
  const now = '2024-06-01T10:08:00Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T10:00:00Z'));
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'fail');
});

test('evaluateRunBudget: unreadable or missing timings returns warn-level (unreadable verdict)', () => {
  const result = evaluateRunBudget('not-json', APPROVAL_NAME, 'pull_request', AIM, LIMIT);
  assert.equal(result.verdict, 'unreadable');
});

test('evaluateRunBudget: missing jobs array returns unreadable', () => {
  const result = evaluateRunBudget({noJobs: true}, APPROVAL_NAME, 'pull_request', AIM, LIMIT);
  assert.equal(result.verdict, 'unreadable');
});

test('evaluateRunBudget: no approval job uses earliest job started_at', () => {
  const now = '2024-01-01T00:04:00Z';
  const apiResponse = makeApiResponse(makeJobsWithoutApproval());
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'ok');
  // Earliest started_at is 2024-01-01T00:00:30Z, so elapsed is 210s.
  assert.equal(result.elapsedSeconds, 210);
});

test('evaluateRunBudget: non-pull_request event is exempt (ok)', () => {
  const now = '2024-06-01T10:30:00Z';
  const apiResponse = makeApiResponse(makeJobsWithoutApproval());
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'schedule', AIM, LIMIT, now);
  assert.equal(result.verdict, 'ok');
  assert.match(result.summary, /exempt/);
});

test('evaluateRunBudget: accepts JSON string input', () => {
  const now = '2024-06-01T10:04:00Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T10:00:00Z'));
  const jsonString = JSON.stringify(apiResponse);
  const result = evaluateRunBudget(jsonString, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'ok');
});

// Real data: run 43710253591, attempt 2
// Approval completed at 11:43:04Z, attempt started at 12:15:04Z, gate ran at 12:15:17Z.
// Without runStartedAt: elapsed from approval = 32 min 13 s → fail (over 420s limit).
// With runStartedAt: elapsed from attempt start = 13 s → ok.
test('evaluateRunBudget: run 43710253591 attempt 2 — with runStartedAt, elapsed is 13s (ok)', () => {
  const now = '2024-06-01T12:15:17Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T11:43:04Z'));
  const runStartedAt = '2024-06-01T12:15:04Z';
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now, runStartedAt);
  assert.equal(result.verdict, 'ok', 'rerun with runStartedAt must be ok (13s elapsed)');
  assert.equal(result.elapsedSeconds, 13, 'elapsed must be 13s from attempt start to gate');
});

test('evaluateRunBudget: run 43710253591 attempt 2 — without runStartedAt, elapsed is 1933s (fail)', () => {
  const now = '2024-06-01T12:15:17Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T11:43:04Z'));
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now);
  assert.equal(result.verdict, 'fail', 'without runStartedAt, elapsed from approval is 1933s → fail');
  assert.equal(result.elapsedSeconds, 1933, 'elapsed must be 1933s from approval to gate');
});

test('evaluateRunBudget: runStartedAt is later than approval on a rerun', () => {
  const now = '2024-06-01T12:20:00Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T11:43:04Z'));
  const runStartedAt = '2024-06-01T12:15:04Z';
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now, runStartedAt);
  assert.equal(result.verdict, 'ok', 'rerun: start is runStartedAt, not approval');
  // 12:20:00 - 12:15:04 = 296s, under 300s aim
  assert.equal(result.elapsedSeconds, 296);
});

test('evaluateRunBudget: runStartedAt earlier than approval on first run', () => {
  const now = '2024-06-01T10:04:30Z';
  const apiResponse = makeApiResponse(makeJobsWithApproval('2024-06-01T10:00:00Z'));
  const runStartedAt = '2024-06-01T09:55:00Z';
  const result = evaluateRunBudget(apiResponse, APPROVAL_NAME, 'pull_request', AIM, LIMIT, now, runStartedAt);
  assert.equal(result.verdict, 'ok');
  // Start is approval (10:00:00), not runStartedAt (09:55:00) — 270s elapsed
  assert.equal(result.elapsedSeconds, 270);
});

// --- CLI exit codes ---
// The script must always exit 0. A non-zero exit means only that the script itself crashed.
// The workflow step reads the verdict and decides whether to fail the gate.

async function runCli(jobs, approvalName, eventName, aim, limit) {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'run-budget-cli-'));
  const jobsFile = path.join(tmpDir, 'jobs.json');
  await fs.promises.writeFile(jobsFile, JSON.stringify(makeApiResponse(jobs)));
  try {
    const result = await execFileAsync('node', [
      scriptPath, jobsFile, approvalName, eventName, String(aim), String(limit)
    ]);
    return {code: 0, stdout: result.stdout, stderr: result.stderr};
  } catch (err) {
    return {code: err.code, stdout: err.stdout, stderr: err.stderr};
  } finally {
    await fs.promises.rm(tmpDir, {recursive: true, force: true});
  }
}

test('CLI exits 0 and prints ok when under the aim', async () => {
  // Use a fixed "now" by setting the approval completed_at so elapsed is 270s (under 300s aim).
  // The CLI uses Date.now(), so we make the approval recent enough.
  const recent = new Date(Date.now() - 270_000).toISOString();
  const {code, stdout} = await runCli(
    [{name: APPROVAL_NAME, completed_at: recent}],
    APPROVAL_NAME,
    'pull_request',
    AIM,
    LIMIT
  );
  assert.equal(code, 0, 'CLI must exit 0 for ok verdict');
  assert.match(stdout, /ok/);
});

test('CLI exits 0 and prints warn between aim and limit', async () => {
  // 360s ago — between aim (300) and limit (420).
  const past = new Date(Date.now() - 360_000).toISOString();
  const {code, stdout} = await runCli(
    [{name: APPROVAL_NAME, completed_at: past}],
    APPROVAL_NAME,
    'pull_request',
    AIM,
    LIMIT
  );
  assert.equal(code, 0, 'CLI must exit 0 for warn verdict');
  assert.match(stdout, /warn/);
});

test('CLI exits 0 and prints fail when over the limit', async () => {
  // 500s ago — over the limit (420).
  const past = new Date(Date.now() - 500_000).toISOString();
  const {code, stdout} = await runCli(
    [{name: APPROVAL_NAME, completed_at: past}],
    APPROVAL_NAME,
    'pull_request',
    AIM,
    LIMIT
  );
  assert.equal(code, 0, 'CLI must exit 0 for fail verdict');
  assert.match(stdout, /fail/);
});

test('CLI exits 0 for non-PR events (exempt)', async () => {
  const past = new Date(Date.now() - 9999_000).toISOString();
  const {code, stdout} = await runCli(
    [{name: APPROVAL_NAME, completed_at: past}],
    APPROVAL_NAME,
    'schedule',
    AIM,
    LIMIT
  );
  assert.equal(code, 0, 'CLI must exit 0 for exempt events');
  assert.match(stdout, /exempt/);
});
