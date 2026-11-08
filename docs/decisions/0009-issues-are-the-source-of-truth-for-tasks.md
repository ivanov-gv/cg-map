# 0009: Issues are the source of truth for tasks

## Status

Accepted.

## Context

Plans in `docs/plans/` held scope, status, the ordered list of remaining steps and their history together. Their step
order mixed real dependencies with a preferred sequence, nothing showed which steps could run in parallel, and status
had to be kept current by a docs PR. GitHub issues support sub-issues and "blocked by" links, and PRs can close them.

## Decision

- A GitHub issue is the source of truth for a task: scope, acceptance criteria, status and remaining work.
- Every PR is connected to an issue, with `Closes #N`, or `Part of #N` when it does only part of the work.
- Multi-PR work is split into sub-issues, one per PR, with "blocked by" links for real dependencies only.
- The task's plan in `docs/plans/` links the issue and is its history: dated entries recording how the plan changed and
  why, and its decisions. It copies no status from the issue.
- A plan is deleted in the PR that resolves its issue. Plans older than this rule convert when they get an issue.

## Consequences

Status and the dependency graph live in one place, where blocked work can be filtered and PRs close issues. The history
of why a plan changed stays reviewable in git. Work is now tracked in two places, so a PR that changes a plan must
update both. GitHub shows only each issue's direct blockers, not the whole graph.
