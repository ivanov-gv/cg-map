# 0050: Selected pre-push checks

## Status

Accepted. Decided for issue [#519](https://github.com/ivanov-gv/cg-map/issues/519).

## Context

The pre-push hook ran `make check` for every push, taking minutes even for a documentation-only change. CI already chose
folder pipelines from the diff with [ci-plan](../../platform/tools/ci-plan.mjs), but the hook had no way to ask for the
same selection. A second classifier in the hook would drift from CI's ownership rules, so the hook had to reuse the
planner. An unreadable diff must not silently skip checks.

## Decision

The hook passes git's pre-push ref lines to [pre-push-plan.mjs](../../platform/tools/pre-push-plan.mjs), which asks
ci-plan for the folders changed by each ref and runs one `make verify PKG=<project>` per distinct local project. The
base is the remote SHA git supplies, or `origin/main` for a new ref; the planner diffs from their merge base. Several
refs select the union of their folders, and a deletion selects nothing. A backend selection still runs `make check-go`
and never enters `make check`. If a ref line, diff or planner cannot be read, the hook reports why and runs `make check`
plus `make check-go` when Go is available; no browser suite runs either way. The folder-to-`PKG` mapping is the inverse
of ci-plan's Makefile-derived project mapping, with the CI folders that have no component mapped to platform. Current
instructions are in [AGENTS.md](../../AGENTS.md) and [.github/TESTING.md](../../.github/TESTING.md).

## Consequences

- A one-project push checks that project and the folders CI's planner adds, rather than every project.
- A change to CI's folder rules needs no second hook mapping; only folders without a component need a local mapping.
- A missing base, malformed input or planner failure costs a full `make check`, which is deliberate: safety beats speed.
- The hook still checks only non-browser targets. Browser acceptance and GitHub's `CI gate` remain the merge gate.
