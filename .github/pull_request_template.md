# Change

Closes #N, or Part of #N when this PR does only part of the issue. Every PR has an issue: open one first.
<!-- A Feature PR stays a draft until its Tasks and Bugs are merged, review findings are fixed and CI is green. -->

## Behavior

What changes for a user or maintainer? State the acceptance criteria from the issue.

## Validation

Links to the GitHub PR run (`CI gate`), or to `workflow_dispatch` runs of the pipelines `make ci-plan BASE=origin/main`
selects on this branch: these must pass before merge. Optional local runs and their results (`make verify`, browser
suites, `make test-e2e`) may be listed as context. For UI changes, attach browser evidence. State what was not verified.
If it adds browser tests, state how many runs they add across all projects.

## Decisions

The record this PR adds to [the decisions log](../docs/decisions/AGENTS.md), or "No important decisions".

## Workflow changes

**A PR merges only when its tests pass on GitHub** ([the rule](TESTING.md)). For changes to `.github/**`, run
`make lint-workflows` locally, then a GitHub test run (`test_run=true`) of every workflow touched and of what
`make ci-plan BASE=origin/main` selects; link the runs and results. `make test-*` (act) runs are optional, except
`make test-cd-dev-pages` when changing ci-publish or cd-dev-pages ([Pages exception](TESTING.md#pages-path-recipe)).
Otherwise delete this section.

## Data and release impact

Source/provenance changes, generated output, compatibility, and rollback if relevant.
