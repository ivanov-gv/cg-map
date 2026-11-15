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

// --- getEffectiveStart ---

test('getEffectiveStart uses approval completed_at when present', () => {
  const jobs = makeJobsWithApproval('2024-06-01T10:05:00Z');
  assert.equal(getEffectiveStart(jobs, APPROVAL_NAME), '2024-06-01T10:05:00Z');
});

test('getEffectiveStart falls back to earliest job started_at when no approval job', () => {
  const jobs = makeJobsWithoutApproval();
  assert.equal(getEffectiveStart(jobs, APPROVAL_NAME), '2024-01-01T00:00:30Z');
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
