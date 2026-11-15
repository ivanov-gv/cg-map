#!/usr/bin/env node
// Computes whether a CI run attempt is within its time budget.
// Start = the approval job's completed_at (if present), else the earliest job's started_at.
// There is no run-start input because the GitHub run context provides no run start timestamp.
// End = now (the gate step's time).
// Verdict: ok (under aim), warn (between aim and limit), fail (over limit), unreadable (bad input).
//
// CLI usage: node run-budget.mjs <jobs-json> <approval-job-name> <event-name> <aim-seconds> <limit-seconds>
// The jobs JSON is the full response from the GitHub API endpoint for a run attempt's jobs.

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

// No run-start parameter: GitHub's run context has no run start timestamp.
function getEffectiveStart(jobs, approvalJobName) {
  const approvalCompleted = getApprovalCompletedAt(jobs, approvalJobName);
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

// Non-PR events (schedule, workflow_dispatch on main, etc.) are exempt.
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
function evaluateRunBudget(jobsJson, approvalJobName, eventName, aimSeconds, limitSeconds, nowIso) {
  let jobs;
  try {
    jobs = typeof jobsJson === 'string' ? JSON.parse(jobsJson) : jobsJson;
  } catch {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — could not parse jobs JSON'};
  }

  if (!Array.isArray(jobs?.jobs)) {
    return {verdict: 'unreadable', elapsedSeconds: null, summary: 'Run budget: unreadable — jobs array not found'};
  }

  const effectiveStart = getEffectiveStart(jobs.jobs, approvalJobName);
  const endIso = nowIso ?? new Date().toISOString();
  const elapsedSeconds = computeElapsedSeconds(effectiveStart, endIso);
  const verdict = getVerdict(elapsedSeconds, aimSeconds, limitSeconds, eventName);
  const summary = buildSummary(verdict, elapsedSeconds, aimSeconds, limitSeconds, eventName);

  return {verdict, elapsedSeconds, summary};
}

// CLI wrapper
if (process.argv[1] && process.argv[1].endsWith('run-budget.mjs')) {
  const [, , jobsFile, approvalJobName, eventName, aimSeconds, limitSeconds] = process.argv;

  if (!jobsFile || !approvalJobName || !eventName || !aimSeconds || !limitSeconds) {
    console.error('Usage: run-budget.mjs <jobs-json-file> <approval-job-name> <event-name> <aim-seconds> <limit-seconds>');
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
