# 0032: Tests pass on GitHub and earn their cost

## Status

Accepted. This changes the local-test requirement in [ADR 0006](0006-ci-time-limits-and-tests-before-merge.md); that
record and its other decisions stay as history. The owner approved the two required local checks, the pre-push
`make check` and `make test-cd-dev-pages`, on 2026-11-22: "I approve local checks. Use GitHub if possible, but local
checks are ok to run too."

## Context

A PR merged only after local tests passed, and a change to `.github/**` also had to pass under `act`. A local browser
suite runs on one worker and takes about 50 minutes, while CI shards the same suite by area and takes about 6 minutes.
The repository is public, so standard runners cost no plan minutes. Local setups differ, and a local pass does not prove
what the runner that gates `main` will do. A scan of apps/web also found redundant tests, so the same decision adds a
guideline for whether a test is worth its cost.

## Decision

- **A PR merges only when its tests pass on GitHub**: its PR run (`CI gate`), or a `workflow_dispatch` of the pipelines
  `make ci-plan BASE=origin/main` selects, on the branch.
- `make check` in the pre-push hook stays required: builds and non-browser checks, no browser suites; the hook also runs
  `make check-go` for services/backend changes. Browser suites (`make -C apps/<x> e2e`, `make test-e2e`) and `act` runs
  are optional for iterating, except `make test-cd-dev-pages` when changing ci-publish or cd-dev-pages
  ([Pages recipe](../../.github/TESTING.md#pages-path-recipe)); they do not gate a merge. Never use `--no-verify`, and
  never delete, skip or loosen a test.
- A workflow change still needs `make lint-workflows` locally, then a GitHub test run (`test_run=true`) of every
  workflow it touches, plus what `make ci-plan BASE=origin/main` selects.
- Every workflow still has three ways to run it — locally under `act` (`test_run`), a manual `workflow_dispatch` with
  `test_run`, and the default production run. A local dry run is a parse check only, not a fourth way. This changes how
  a PR is verified, not how workflows are built.
- The only required local workflow run is `make test-cd-dev-pages COMMIT=<sha>` for cd-dev-pages' `workflow_run` path,
  which GitHub cannot exercise before merge.
- The [testing guideline](../engineering/testing.md) applies to every new or changed test: one behaviour, one test;
  remove a passing redundant test only with proof that a remaining test fails on the same change. A failing test is
  never removed.
- Current guidance: [testing workflows](../../.github/TESTING.md) and [testing](../verification/testing.md).

## Consequences

- A merge waits for GitHub results rather than a developer machine; a local browser pass is not evidence for merge.
- Long local browser suites no longer delay development, and a fast local run can still guide iteration. The pre-push
  builds and non-browser checks still run on every push.
- A GitHub outage, an un-dispatchable workflow, or a missing `CI gate` delays a merge. Workflows not yet on `main` keep
  the existing test-run-evidence exemption.
- The Pages `workflow_run` path still needs the labelled local `make test-cd-dev-pages COMMIT=<sha>` exception before
  merge.
- Hooks remain unchanged: pre-commit and pre-push still run their checks, with `make check` as the one required local
  check (builds and non-browser checks, no browser suites); CI remains the contract. This weakens neither a test nor a
  check.
- The testing guideline keeps runner time for tests that catch unique regressions; redundant tests need proof before
  removal, and failing tests stay.
