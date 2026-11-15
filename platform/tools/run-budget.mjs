#!/usr/bin/env node
// Computes whether a CI run attempt is within its time budget.
// Start = the later of the approval job's completed_at and the run attempt's run_started_at.
// If run_started_at is unreadable, fall back to the approval time; if neither is available, use the earliest job start.
// End = now (the gate step's time).
// Verdict: ok (under aim), warn (between aim and limit), fail (over limit), unreadable (bad input).
//
// CLI usage: node run-budget.mjs <jobs-json> <approval-job-name> <event-name> <aim-seconds> <limit-seconds> <run-started-at>
// The jobs JSON is the full response from the GitHub API endpoint for a run attempt's jobs.
// The run_started_at is the ISO timestamp from the run attempt endpoint (optional).

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
  const startMs = parseTimestamp(startIso);
  const endMs = parseTimestamp(endIso);
  if (startMs === null || endMs === null) return null;
  return (endMs - startMs) / 1000;
}

// Non-PR events (schedule, workflow_dispatch, workflow_call) are exempt from the budget:
// nightly and dispatched runs already check everything, so there is no budget to enforce.
function getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName) {
  if (eventName !== 'pull_request') return 'ok';
  if (elapsedSeconds === null) return 'unreadable';
  if (elapsedSeconds <= aimSeconds) return 'ok';
  if (elapsedSeconds <= limitSeconds) return 'warn';
  return 'fail';
}

function buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName) {
  const lines = [];
  if (eventName !== 'pull_request') {
    lines.push(`Run budget: exempt (event: ${eventName})`);
    return lines.join('\n');
  }
  if (elapsedSeconds === null) {
    lines.push('Run budget: unreadable — could not determine elapsed time');
    return lines.join('\n');
  }
  lines.push(`Run budget: ${elapsedSeconds.toFixed(0)}s elapsed (aim ${aimSeconds}s, limit ${limitSeconds}s) — ${verdict}`);
  return lines.join('\n');
}

// Evaluate the run budget from parsed jobs JSON.
// Returns {verdict, elapsedSeconds, summary}.
// The runStartedAt parameter is optional: when provided, the effective start is the later of
// the approval time and the run attempt start, correctly handling reruns.
function evaluateRunBudget(jobsJson, approvalJobName, eventName, aimSeconds, limitSeconds, nowIso, runStartedAt) {
  let jobs;
  try {
    jobs = typeof jobsJson === 'string' ? JSON.parse(jobsJson) : jobsJson;
  } catch {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — could not parse jobs JSON'};
  }

  if (!Array.isArray(jobs?.jobs)) {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — jobs array not found'};
  }

  const effectiveStart = getEffectiveStart(jobs.jobs, approvalJobName, runStartedAt);
  const endIso = nowIso ?? new Date().toISOString();
  const elapsedSeconds = computeElapsedSeconds(effectiveStart, endIso);
  const verdict = getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName);
  const summary = buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName);

  return {verdict, elapsedSeconds, summary};
}

// CLI wrapper
if (process.argv[1] && process.argv[1].endsWith('run-budget.mjs')) {
  const [, , jobsFile, approvalJobName, eventName, aimSeconds, limitSeconds, runStartedAt] = process.argv;

  if (!jobsFile || !approvalJobName || !eventName || !aimSeconds || !limitSeconds) {
    console.error('Usage: run-budget.mjs <jobs-json-file> <approval-job-name> <event-name> <aim-seconds> <limit-seconds> [run-started-at]');
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
    runStartedAt
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
