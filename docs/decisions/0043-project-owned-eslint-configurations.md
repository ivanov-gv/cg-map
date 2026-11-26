# 0043: Project-owned ESLint configurations

## Status

Accepted. Implements the lint part of [#458](https://github.com/ivanov-gv/cg-map/issues/458).

## Context

One root `eslint.config.mjs` named the folders and patterns of every project. A project that added or moved a kind of
file had to change that root file, and changing it selected the whole CI: PR #463 measured 496 s against the 420 s gate
budget. The root file also made a project's lint rules a repository-wide change, while projects otherwise own their own
lint targets and tests.

## Decision

Every project that lints owns an `eslint.config.mjs` beside its Makefile or package.json. ESLint runs from that project,
so the config chooses that project's file patterns and globals. All rule sets come from one module,
[platform/eslint-rules.mjs](../../platform/eslint-rules.mjs); its project-independence rule is in
[JavaScript conventions](../../docs/engineering/javascript.md#lint-configuration). The root config is gone.

The planner gives a project's own config that project's verify; it discovers the shared rules' consumers from the
project configs present in the checkout; the shared probe selects the same projects. Neither selection schedules a
browser job: lint and readability tooling cannot change what a browser does. Each app owns a readability test that calls
the shared probe helper against its own config. A project's config selects that project's verify; changes under
`apps/web/` or `apps/editor/` still run that app's own browser suite through its workflow.

## Consequences

- Adding a new kind of file in a project needs only that project's config; no project changes another's lint scope.
- A shared rule change runs the verify of every project with a config, but no browser suite. A rule that applies to only
  one project's files still stays in that project's config, which selects only that project's verify.
- A readability-probe change runs the verify of every project with a config, but no browser suite.
- The new dev dependency is recorded in
  [architecture](../../docs/system-architecture/architecture.md#independent-projects); the planner discovers its
  consumers from the project configs.
- Every project keeps linting the files it linted before; the lint config files themselves are linted by their owners.

### Outcome note: staged recovery in #475 (2026-11-26)

- #466 proposed all nine project configs in one change. Its discussion asked for a stack because selecting both map
  apps' folders also runs their browser shards, and the owner required at most one app per PR. The accepted decision
  stays the target; #475 lands only the shared rules and the six non-app configs.
- The root `eslint.config.mjs` stays byte-for-byte as on main and keeps serving Web, Editor and core-demo. Platform
  keeps its original root-config readability test until the replacement app-owned tests land. The readability probe
  helper and its planner rule are deferred to those app migrations.
- Shared rules select only configs present in the checkout, so no app is selected now. A root-config change keeps the
  whole-plan selection; an app config change will select that app's folder and its whole workflow. The current consumers
  live in [architecture](../../docs/system-architecture/architecture.md#independent-projects).
- Pre-commit uses a staged file's own config when one exists and otherwise runs the root config with unchanged paths.
- Next: Web, Editor and core-demo migrate in their own PRs; the root config is deleted only once no app reads it.

### Outcome note: HEAD reads for lint tooling (2026-11-26)

- Rule: a project's tests read only its own files or an exact published version of another project, never another's HEAD
  ([architecture](../../docs/system-architecture/architecture.md#independent-projects)).
- Constraint: ESLint resolves each project's config and the shared rules from the checkout, and a readability test must
  lint sample code through the real config or a narrowed glob would pass unnoticed.
- Experiment: scratch probes showed that removing the restricted-import rule, narrowing the pure-module glob and
  removing a data boundary are each caught, so the readability test has to read the live config.
- Reasoning: `platform/eslint-rules.mjs` is development tooling like the ESLint binary and its plugins, not runtime data
  or a published contract. Pinning it would need a package release for every rule change and would stop the test from
  checking the config as it is about to ship.
- Scope: that file, read by project lint through its own config or the root config. Runtime, data and contract pins are
  unchanged.
- Owner approval: requested in the #458 PR.
