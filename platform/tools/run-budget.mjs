#!/usr/bin/env node
// Computes whether a CI run attempt is within its time budget.
// Start = the approval job's completed_at (if present), else the run's started_at.
// End = now (the gate step's time).
// Verdict: ok (under aim), warn (between aim and limit), fail (over limit), unreadable (bad input).
//
// CLI usage: node run-budget.mjs <jobs-json> <run-started-at> <event-name> <aim-seconds> <limit-seconds>
// The jobs JSON is the full response from the GitHub API endpoint for a run attempt's jobs.

import {readFileSync} from 'node:fs';

/**
 * Extract the approval job's completed_at timestamp, or null if absent.
 */
function getApprovalCompletedAt(jobs) {
  const approvalJob = jobs.find(job => job.name === 'Approve CI run');
  return approvalJob?.completed_at ?? null;
}

/**
 * Return the earliest started_at from all jobs, or null if none have it.
 */
function getEarliestStartedAt(jobs) {
  let earliest = null;
  for (const job of jobs) {
    if (job.started_at && (!earliest || job.started_at < earliest)) {
      earliest = job.started_at;
    }
  }
  return earliest;
}

/**
 * Return the effective start time (ISO string or null).
 * Uses the approval job's completed_at if available, otherwise the run's started_at,
 * or the earliest job's started_at as a last resort.
 */
function getEffectiveStart(jobs, runStartedAt) {
  const approvalCompleted = getApprovalCompletedAt(jobs);
  if (approvalCompleted) return approvalCompleted;
  if (runStartedAt) return runStartedAt;
  return getEarliestStartedAt(jobs);
}

/**
 * Parse an ISO timestamp string to a number of milliseconds, or null if invalid.
 */
function parseTimestamp(isoString) {
  if (!isoString || typeof isoString !== 'string') return null;
  const time = Date.parse(isoString);
  return Number.isNaN(time) ? null : time;
}

/**
 * Compute elapsed seconds between start and end timestamps.
 * Returns null if either timestamp is unreadable.
 */
function computeElapsedSeconds(startIso, endIso) {
  const startMs = parseTimestamp(startIso);
  const endMs = parseTimestamp(endIso);
  if (startMs === null || endMs === null) return null;
  return (endMs - startMs) / 1000;
}

/**
 * Return the verdict string for the given elapsed seconds and limits.
 * Returns "unreadable" when elapsedSeconds is null.
 * Returns "ok" when the event is not a pull_request (exempt).
 */
function getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName) {
  // Non-PR events (schedule, workflow_dispatch on main, etc.) are exempt.
  if (eventName !== 'pull_request') return 'ok';
  if (elapsedSeconds === null) return 'unreadable';
  if (elapsedSeconds <= aimSeconds) return 'ok';
  if (elapsedSeconds <= limitSeconds) return 'warn';
  return 'fail';
}

/**
 * Build a summary line describing the run budget result.
 */
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

/**
 * Evaluate the run budget from parsed jobs JSON.
 * Returns an object with {verdict, elapsedSeconds, summary}.
 * @param {string|object} jobsJson - JSON string or parsed object from the GitHub API.
 * @param {string} runStartedAt - ISO timestamp of the run's start.
 * @param {string} eventName - GitHub event name (e.g. "pull_request", "schedule").
 * @param {number} aimSeconds - Target elapsed seconds (ok below this).
 * @param {number} limitSeconds - Hard limit (fail above this).
 * @param {string} [nowIso] - Optional ISO timestamp for "now" (used in tests; defaults to current time).
 */
function evaluateRunBudget(jobsJson, runStartedAt, eventName, aimSeconds, limitSeconds, nowIso) {
  let jobs;
  try {
    jobs = typeof jobsJson === 'string' ? JSON.parse(jobsJson) : jobsJson;
  } catch {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — could not parse jobs JSON'};
  }

  if (!Array.isArray(jobs?.jobs)) {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — jobs array not found'};
  }

  const effectiveStart = getEffectiveStart(jobs.jobs, runStartedAt);
  const endIso = nowIso ?? new Date().toISOString();
  const elapsedSeconds = computeElapsedSeconds(effectiveStart, endIso);
  const verdict = getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName);
  const summary = buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName);

  return {verdict, elapsedSeconds, summary};
}

// CLI wrapper
if (process.argv[1] && process.argv[1].endsWith('run-budget.mjs')) {
  const [, , jobsFile, runStartedAt, eventName, aimSeconds, limitSeconds] = process.argv;

  if (!jobsFile || !runStartedAt || !eventName || !aimSeconds || !limitSeconds) {
    console.error('Usage: run-budget.mjs <jobs-json-file> <run-started-at> <event-name> <aim-seconds> <limit-seconds>');
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
    runStartedAt,
    eventName,
    Number(aimSeconds),
    Number(limitSeconds)
  );

  console.log(summary);

  if (elapsedSeconds !== null) {
    console.log(`Elapsed: ${elapsedSeconds.toFixed(0)}s`);
  }

  console.log(verdict);

  if (verdict === 'fail') {
    process.exit(1);
  }
}

export {getApprovalCompletedAt, getEarliestStartedAt, getEffectiveStart, parseTimestamp, computeElapsedSeconds, getVerdict, buildSummary, evaluateRunBudget};
