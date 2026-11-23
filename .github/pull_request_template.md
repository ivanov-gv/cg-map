# Change

Closes #N, or Part of #N when this PR does only part of the issue. Every PR has an issue: open one first.
<!-- A Feature PR stays a draft until its Tasks and Bugs are merged, review findings are fixed and CI is green. -->

## Behavior

What changes for a user or maintainer? State the acceptance criteria from the issue.

## Validation

Link to the GitHub PR run (`CI gate`): it must pass before merge. For a workflow change, `CI gate` proves the changed
`ci-*` and `cd-*` workflows itself; link any manual test runs needed for an exception, such as `ci-pr-checks.yml` or
`ci-nightly.yml`. Optional local runs and their results (`make verify`, browser suites, `make test-e2e`) may be listed
as context. For UI changes, attach browser evidence. State what was not verified. If it adds browser tests, state how
many runs they add across all projects.

## Decisions

The record this PR adds to [the decisions log](../docs/decisions/AGENTS.md), or "No important decisions".

## Workflow changes

**A PR merges only when its tests pass on GitHub** ([the rule](TESTING.md)). For changes to `.github/**`, run
`make lint-workflows` locally, then push: `CI gate` calls changed `ci-*` workflows in test-run mode and dispatches and
waits for changed `cd-*` workflows. Link any manual test run still needed for an exemption (for example a change to
`ci-pr-checks.yml` or `ci-nightly.yml`, which cannot call themselves) and the `make ci-plan BASE=origin/main` output.
`make test-*` (act) runs are optional, except `make test-cd-dev-pages` when changing ci-publish or cd-dev-pages
([Pages exception](TESTING.md#pages-path-recipe)). Otherwise delete this section.

## Data and release impact

Source/provenance changes, generated output, compatibility, and rollback if relevant.
