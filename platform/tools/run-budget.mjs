#!/usr/bin/env node
// Computes whether a CI run attempt is within its time budget.
// Start = the later of the approval job's completed_at and the run attempt's run_started_at.
// If run_started_at is unreadable, fall back to the approval time; if neither is available, use the earliest job start.
// End = now (the gate step's time).
// Verdict: ok (under aim), warn (between aim and limit), fail (over limit), unreadable (bad input).
//
// CLI usage: node run-budget.mjs <jobs-json> <approval-job-name> <event-name> <aim-seconds> <limit-seconds> <run-started-at> <cd-test-runs>
// The jobs JSON is one GitHub API jobs response, or every page slurped into an array of responses, as fetched with
// `gh api ".../jobs?per_page=100" --paginate --slurp`. Jobs from all pages are combined before evaluation.
// The run_started_at is the ISO timestamp from the run attempt endpoint (optional).
// cd-test-runs is a JSON array of CD workflows whose external test runs this PR waits for (optional).

import {readFileSync} from 'node:fs';

function getApprovalCompletedAt(jobs, approvalJobName) {
  const approvalJob = jobs.find(job => job.name === approvalJobName);
  return approvalJob?.completed_at ?? null;
}

function getEarliestStartedAt(jobs) {
  let earliest = null;
  for (const job of jobs) {
    if (job.started_at && (!earliest || job.started_at < earliest)) {
      earliest = job.started_at;
    }
  }
  return earliest;
}

// Returns the later of two ISO timestamps, or the one that is not null.
function laterOf(isoA, isoB) {
  if (!isoA) return isoB;
  if (!isoB) return isoA;
  return isoA >= isoB ? isoA : isoB;
}

// Compute the effective start time for the run budget.
// Priority: later of (approval completed_at, run_started_at).
// If run_started_at is unreadable, fall back to approval time (if available), else earliest job start.
// This handles reruns correctly: a rerun starts after the original approval, so run_started_at is the true start.
function getEffectiveStart(jobs, approvalJobName, runStartedAt) {
  const approvalCompleted = getApprovalCompletedAt(jobs, approvalJobName);

  // When we have a run_started_at from the attempt endpoint, use the later of it and the approval time.
  // On a rerun, run_started_at is after the approval, so it becomes the start.
  // On a first run, approval is after run_started_at, so approval becomes the start.
  if (runStartedAt && parseTimestamp(runStartedAt) !== null) {
    return laterOf(approvalCompleted, runStartedAt);
  }

  // No run_started_at available — fall back to approval time, then earliest job start.
  if (approvalCompleted) return approvalCompleted;
  return getEarliestStartedAt(jobs);
}

function parseTimestamp(isoString) {
  if (!isoString || typeof isoString !== 'string') return null;
  const time = Date.parse(isoString);
  return Number.isNaN(time) ? null : time;
}

function computeElapsedSeconds(startIso, endIso) {
  const startMilliseconds = parseTimestamp(startIso);
  const endMilliseconds = parseTimestamp(endIso);
  if (startMilliseconds === null || endMilliseconds === null) return null;
  return (endMilliseconds - startMilliseconds) / 1000;
}

// Non-PR events are exempt: nightly and dispatched runs check everything. A PR that waits for CD test runs is also
// exempt: the external browser-image build is longer than the whole-run budget, and the waiter has its own time limit.
function getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName, cdTestRuns = []) {
  if (eventName !== 'pull_request') return 'ok';
  if (cdTestRuns.length) return 'ok';
  if (elapsedSeconds === null) return 'unreadable';
  if (elapsedSeconds <= aimSeconds) return 'ok';
  if (elapsedSeconds <= limitSeconds) return 'warn';
  return 'fail';
}

function buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName, cdTestRuns = []) {
  const lines = [];
  if (eventName !== 'pull_request') {
    lines.push(`Run budget: exempt (event: ${eventName})`);
    return lines.join('\n');
  }
  if (cdTestRuns.length) {
    lines.push(`Run budget: exempt (waiting for CD test runs: ${cdTestRuns.join(', ')})`);
    return lines.join('\n');
  }
  if (elapsedSeconds === null) {
    lines.push('Run budget: unreadable — could not determine elapsed time');
    return lines.join('\n');
  }
  lines.push(`Run budget: ${elapsedSeconds.toFixed(0)}s elapsed (aim ${aimSeconds}s, limit ${limitSeconds}s) — ${verdict}`);
  return lines.join('\n');
}

// Returns the jobs from one API response or from every page slurped into an array of responses.
// Returns null for an unexpected shape, so the caller can report unreadable input.
function collectJobs(parsedInput) {
  const responsePages = Array.isArray(parsedInput) ? parsedInput : [parsedInput];
  if (responsePages.length === 0 || !responsePages.every(page => Array.isArray(page?.jobs))) return null;
  return responsePages.flatMap(page => page.jobs);
}

// Evaluate the run budget from parsed jobs JSON.
// Returns {verdict, elapsedSeconds, summary}.
// The runStartedAt parameter is optional: when provided, the effective start is the later of
// the approval time and the run attempt start, correctly handling reruns.
function evaluateRunBudget(jobsJson, approvalJobName, eventName, aimSeconds, limitSeconds, nowIso, runStartedAt, cdTestRuns = []) {
  let jobs;
  try {
    const parsedInput = typeof jobsJson === 'string' ? JSON.parse(jobsJson) : jobsJson;
    jobs = collectJobs(parsedInput);
  } catch {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — could not parse jobs JSON'};
  }

  let waitingFor = cdTestRuns;
  try {
    waitingFor = typeof waitingFor === 'string' ? JSON.parse(waitingFor) : waitingFor;
  } catch {
    waitingFor = [];
  }
  if (!Array.isArray(waitingFor)) waitingFor = [];

  if (!jobs) {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — jobs array not found'};
  }

  const effectiveStart = getEffectiveStart(jobs, approvalJobName, runStartedAt);
  const endIso = nowIso ?? new Date().toISOString();
  const elapsedSeconds = computeElapsedSeconds(effectiveStart, endIso);
  const verdict = getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName, waitingFor);
  const summary = buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName, waitingFor);

  return {verdict, elapsedSeconds, summary};
}

// CLI wrapper
if (process.argv[1] && process.argv[1].endsWith('run-budget.mjs')) {
  const [, , jobsFile, approvalJobName, eventName, aimSeconds, limitSeconds, runStartedAt, cdTestRuns] = process.argv;

  if (!jobsFile || !approvalJobName || !eventName || !aimSeconds || !limitSeconds) {
    console.error('Usage: run-budget.mjs <jobs-json-file> <approval-job-name> <event-name> <aim-seconds> <limit-seconds> [run-started-at] [cd-test-runs]');
    process.exit(1);
  }

  let jobsJson;
  try {
    jobsJson = readFileSync(jobsFile, 'utf8');
  } catch (err) {
    console.error(`Could not read jobs file: ${err.message}`);
    console.log('unreadable');
    process.exit(0);
  }

  const {verdict, elapsedSeconds, summary} = evaluateRunBudget(
    jobsJson,
    approvalJobName,
    eventName,
    Number(aimSeconds),
    Number(limitSeconds),
    undefined,
    runStartedAt,
    cdTestRuns
  );

  console.log(summary);

  if (elapsedSeconds !== null) {
    console.log(`Elapsed: ${elapsedSeconds.toFixed(0)}s`);
  }

  console.log(verdict);
  // Always exit 0 — a non-zero exit means only that the script itself crashed.
  // The workflow step reads the verdict and decides whether to fail the gate.
}

export {getApprovalCompletedAt, getEarliestStartedAt, laterOf, getEffectiveStart, parseTimestamp, computeElapsedSeconds, getVerdict, buildSummary, evaluateRunBudget};
