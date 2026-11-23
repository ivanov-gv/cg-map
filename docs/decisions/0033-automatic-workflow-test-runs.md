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

## Outcome note (issue #372, 2026-11-23)

A planner-file change is proved by the workflow that executes that file: `workflow-test-runs.mjs` and its test select
`ci-workflows.yml`, while `ci-plan.mjs` and its test select the workflows that use the `plan` action. The automatic
`ci-publish` test call plans by the PR diff unless its `run_all` input is true, so it builds the browser image only when
browser-image inputs changed, by the same planner rule as a push to `main`.

## Update (issue #377, part A, 2026-11-23)

A changed folder workflow whose folder the diff selects is now proved by its regular call with `test_run`, rather than
by a second call with the full browser matrix; PR #373 exceeded the 420 s run budget from that duplication. The planner
splits its selection into `ci_in_place_test_runs` and `ci_test_runs`. A separate browser call uses one short, unsharded
area to prove the workflow's jobs and steps, not every test, and keeps the default tagged phone tests. The `workflows`
call still dispatches changed CD workflows on a regular PR run: its in-place test-run mode is not a test run of
`ci-pr-checks`, and only the latter suppresses dispatch. Published images also carry a moving `:dev` tag and an
`org.opencontainers.image.revision` label so a consumer can tie that tag to an exact commit. A review closed the
empty-list gaps in the same approach: an in-place web or editor call uses the smoke matrix when the diff selects no
area, and an in-place workflows call runs the CD dispatcher's no-op path when no CD workflow changed, so every job of
the changed workflow still runs. The decision above is unchanged; only the cost and destination of the same evidence
changed.

## Update (issue #377, part B, 2026-11-23)

CD test runs no longer check the PR head and then walk main's history. They read the dev tag once per changed workflow:
the version behind `@ivanov-gv/<pkg>@dev` for a package, or the `org.opencontainers.image.revision` label on
`<repository>/<name>:dev` for an image. The label comes from
`docker buildx imagetools inspect --format '{{json .Image}}'` (the `linux/amd64` entry when it is an OCI index), so the
moving tag is inspected rather than pulled. Both must name a full commit, which the dispatcher logs and uses for the CD
dispatch and the commit-tag image pull. This supersedes the fallback described in the #366 outcome note and removes the
`git fetch` of main. Reusing an earlier successful test run of the head commit stays. The #370 fix also runs `npm view`
from a temporary directory, outside the repository's `.npmrc`, and distinguishes E404 from other registry failures.
