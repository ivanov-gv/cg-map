# Task: `auto-workflow-test-runs`

Issue: `#334`. The issue and its sub-issues hold scope, status and dependencies; this plan holds their history.

## Context

Workflow changes used to be proved by a `test-run-evidence` job that asked a maintainer to dispatch test runs by hand.
The rule already said that a GitHub test run, never a local dry run, is the merge evidence
([ADR 0032](../decisions/0032-tests-pass-on-github-and-earn-their-cost.md)); this task makes the gate run those tests
itself. CI remains independent of CD: CI calls callable CI workflows and dispatches CD workflows through the workflow
tool, while CD keeps its own triggers and release boundary. The owner approved the approach on 2026-11-23 with the
caveats that a test run must be real, that CD cannot be a reusable workflow, that a free plan needs the waiter to cover
a browser-image build, and that new CI workflows are covered by `workflow_call` while new CD workflows wait for `main`.

## Decisions

- Pure selection and orchestration live in `platform/tools/workflow-test-runs.mjs`; `ci-plan.mjs` only exposes the
  selected workflows and full browser matrices as outputs.
- `ci-pr-checks.yml` has static reusable-call jobs for every callable CI workflow, gated by the planner's `ci_test_runs`
  output, so no matrix is passed to `uses:`. `ci-pr-checks.yml` and `ci-nightly.yml` are manual exceptions because a
  call to either would cycle.
- `ci-workflows.yml` replaces the evidence job with a dispatcher that reuses a successful test run of the head commit or
  dispatches one with a collision-free version, then waits for the conclusion. The head commit's dev artifact is
  preferred; the newest main commit with one is the documented fallback.
- Current behavior and commands stay in [.github/TESTING.md](../../.github/TESTING.md); the reasoning is recorded in
  [ADR 0033](../decisions/0033-automatic-workflow-test-runs.md).

## History

- 2026-11-23: Addressed compliance review: exempted PRs that wait for CD test runs from the whole-run budget, restored
  caller-context guards, explained manual exemptions in the job summary, and recorded coverage proofs for the replaced
  evidence assertions. (#334)
- 2026-11-23: Replaced the manual evidence check with planner-selected reusable CI test calls and a CD dispatch/wait
  job, and documented both manual exceptions. (#334)
- 2026-11-23: Wrote the plan after the owner approved issue #334 with the test-run and free-plan caveats. (#334)
