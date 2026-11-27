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
- Shared rules select only configs present in the checkout, so only the six non-app configs are consumers in this step.
  A root-config change keeps the whole-plan selection; an app config change will select that app's folder and its whole
  workflow without a planner change. The current consumers live in
  [architecture](../../docs/system-architecture/architecture.md#independent-projects).
- Pre-commit uses a staged file's own config when one exists and otherwise runs the root config with unchanged paths.
- The unchanged root config owns app lint and imports `@eslint/js` and `globals` directly; it does not import the shared
  module. Its app rule values may temporarily duplicate future shared rules. That duplication is bounded by the planned
  app migrations and the later root cleanup, not a second source of truth for migrated projects.
- Next: Web, Editor and core-demo migrate in their own PRs; the root config is deleted only once no app reads it.

### Outcome note: Editor migration in #478 (2026-11-26)

- #478 merges main with #466 (`1913b69`, closing #475) into the reorganized Editor branch and adds
  `apps/editor/eslint.config.mjs`. The root file is byte-for-byte identical to main; it keeps serving apps/web and
  apps/core-demo, so only the Editor's lint scope moved. Its Editor globs are now unused and leave with the root
  cleanup.
- The Editor config keeps browser globals for runtime, service-worker globals for `src/sw.js`, Node and browser globals
  for tools, colocated tests and both app configs, the shared mechanical rules, and the 80-line production/tools budget.
  Long linear scenarios stay allowed in `*.test.js` and `*.browser.test.js`. An Editor-owned test lints samples at
  nested production, unit and browser-test paths through that real config. The Editor's pin guard keeps its original
  full `tests/` scan, including browser specs and helpers, and adds colocated source/tool tests and the optional `e2e/`
  folder beside `src` without scanning production build tools.
- The shared probe helper stays deferred: #478 changes no Platform code, so the Editor's lint test repeats the Platform
  probe samples until the next app migration adds the helper and moves both tests to it.
- The planner needs no change: the new config maps to the Editor's own folder and workflow.
  `make ci-plan BASE=origin/main` selected the subset `docs, platform, tests, apps-editor`, with no CI test-run calls,
  in-place runs, CD dispatches or manual runs. Platform stays a genuine consumer of Editor paths until its other HEAD
  checks move later in #458. CI budgets are unchanged; Web and core-demo migrate separately before the root file is
  removed.

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
- Scope: that file, read at HEAD only by the migrated non-app configs through their own configs. The apps' root config
  does not import it. Runtime, data and contract pins are unchanged.
- Owner approval: requested in the #458 PR.

### Outcome note: Core Demo migration (2026-11-26)

- Task #479 moves only apps/core-demo to its own `eslint.config.mjs`, which imports the shared rule exports. Its lint
  command runs from that folder over source, tools, tests, journeys and the app config; the root file stays
  byte-for-byte unchanged and still serves Web.
- Recursive patterns cover runtime, tools in both extensions, source unit tests, component-browser tests and nested
  `tests/**/*.mjs`, including current `tests/e2e/*.spec.mjs` journeys. `e2e/**/*.js` also covers the beside-src journey
  layout in JavaScript conventions. Runtime and tool helpers keep the 80-line function budget; `max-lines-per-function`
  is off only for `*.test.js` paths. Node globals cover `.mjs` tools, nested tests, unit and browser tests, and
  journeys. Existing representative paths keep their effective rules and globals; no lint target is removed.
- A Core Demo test calls ESLint through the real app config. It proves that nested runtime and tool files reject
  readability violations, that nested runtime files also reject excessive depth, that `_`-prefixed parameters stay
  accepted, that helpers keep the function budget for both tool extensions, that unit, browser and journey paths accept
  their globals, that long tests keep the exception, and that journey paths still reject readability violations.
- With the Editor migration (#478, merged in #473) on main, the consumers are the six non-app projects, apps/editor and
  apps/core-demo. Only apps/web still uses the root file.

### Outcome note: Web migration and root retirement (2026-11-27)

- Task #456 gives apps/web its own `eslint.config.mjs`. It consumes the shared exports and keeps the root config's
  globals and rules for every file Web lints: browser and vendored globals for runtime, worker globals and a script
  source type for `src/sw.js`, Node and browser globals for tools and tests, the runtime import boundary, the four pure
  modules, both mechanical rule sets and the 80-line production/tool budget. The documented exception lets long linear
  `*.test.js` scenarios exceed that budget. No existing file loses a rule.
- `npm run lint` now runs `eslint .` from apps/web and then Web's runtime module guards. A Web-owned test lints samples
  through that real config at nested runtime, tool, unit-test and browser-test paths; it replaces Platform's root-config
  readability probe, which is repointed to Platform's own config and the shared common rules.
- The root `eslint.config.mjs` is deleted: no app reads it, and `check-repo` rejects a new root-level config. The
  planner maps a change to that retired path to platform only, since the pre-commit hook and layout check own it; app
  configs keep selecting their own verify and workflow.
- `make ci-plan BASE=origin/main` selects a subset with docs, platform and apps-web, with no whole-plan selection.
