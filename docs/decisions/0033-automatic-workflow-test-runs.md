# 0033: Automatic workflow test runs in the PR gate

## Status

Accepted.

## Context

[ADR 0032](0032-tests-pass-on-github-and-earn-their-cost.md) made GitHub test runs the merge evidence, but the mechanism
was a `test-run-evidence` job in `ci-workflows.yml`. It searched for runs that a human had dispatched and told the
maintainer to dispatch a missing one. That left a changed workflow unproven until someone noticed the failure, read the
message, and chose a version and a source commit by hand. The failure was also easy to misread as a flaky check, and
re-running it could never produce a run.

The intent of the rule is evidence that a changed workflow still works on GitHub, not a checklist of commands. CI must
not become CD: it may not publish a release, and CD keeps its own trigger and permission boundary
([ADR 0017](0017-ci-cd-model.md)). Browser-image test runs can take longer than the seven-minute job limit, so a waiter
must cover the build. It occupies a runner while polling, but does not repeat the build.

## Decision

A change to a workflow is proved in the same `CI gate` that checks the rest of the PR:

- `ci-pr-checks.yml` calls every changed callable `ci-*` workflow with `test_run: true`, every browser area and every
  phone test. A shared action is proved through a workflow that executes it. Calls are static because GitHub cannot
  build a reusable call from a matrix; the planner output only decides which calls run.
- CD workflows cannot be called: `ci-workflows.yml` dispatches each changed `cd-*` workflow with `test_run=true`, the
  head commit and a unique test version, then waits for its conclusion. It reuses an existing successful test run of the
  head commit. If no dev artifact exists for that commit, it falls back to the newest successful main commit with one
  and reports the fallback in the job summary.
- `ci-pr-checks.yml` and `ci-nightly.yml` remain manual exceptions: a reusable call to either would form a cycle, and a
  workflow not registered on `main` cannot be dispatched. Other workflows that are not yet on `main`, or whose main
  version lacks the dispatch inputs, are exempt with a visible reason.
- The wait job has `actions: write`, `packages: read` and a 30-minute timeout. Only test-run destinations are written;
  production publishing still happens solely on `main`. A PR waiting for CD test runs is exempt from the whole-run
  budget, because an external browser-image build can outlast it; the waiter's timeout bounds the wait.

Current procedure and the exact manual commands live in [.github/TESTING.md](../../.github/TESTING.md).

## Consequences

A PR that changes a workflow cannot pass its gate until the real test run passes, so no manual evidence step is needed
for ordinary changes. Each changed browser workflow runs every browser area, which costs more than the narrowly planned
PR run but is what proves the workflow itself. The static reusable calls grant `packages: write` to the `ci-publish`
test call and `actions: write` to the `ci-workflows` test call because GitHub checks a called workflow's permissions
statically, even when only its test-run jobs execute; no test-run job uses those writes. `ci-nightly.yml` grants the
same scopes to its call for the same reason. The static calls and dispatcher are covered by structural tests in
`platform/tests/workflows.test.mjs`, alongside pure selection tests in `platform/tests/workflow-test-runs.test.mjs`. A
new CD workflow still cannot be dispatched until it has landed on `main`; its first PR is proved by the CI paths and by
a manual test run of what it calls.

## Outcome note (issue #366, 2026-11-23)

The fallback now takes its candidates from main's history: the last 20 commits of `origin/main`, newest first, rather
than from successful `ci-publish` runs. A run can fail after one of its jobs has published a dev package or image, so
its conclusion is not evidence that the commit has no artifact. Every candidate is still checked at the registry and the
search stops at the first artifact, which bounds the dispatcher's work.
