# Change

## Behavior

What changes for a user or maintainer? Link the issue and state acceptance criteria.

## Validation

Commands run locally and results: these must pass before merge. For UI changes, attach browser evidence. State what was
not verified.

## Decisions

The record this PR adds to [the decisions log](../docs/decisions/AGENTS.md), or "No important decisions".

## Workflow changes

**No merge until local tests pass** ([the rule](TESTING.md)). For changes to `.github/**`, the `make test-*` commands
run locally on the final commit and their results, plus links to the test runs on GitHub. Otherwise delete this section.

## Data and release impact

Source/provenance changes, generated output, compatibility, and rollback if relevant.
