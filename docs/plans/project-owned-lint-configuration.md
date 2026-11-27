# Task: Project-owned ESLint configuration

Issue: #458. The issue and its sub-issues hold scope, status and dependencies; this plan holds their history.

## Context

PR #466 built project-owned lint configurations, shared rules and a readability probe for all nine linting projects in
one change. Its discussion showed that selecting both map apps' folders also runs their browser shards, and the owner
required one app per PR. Task #475 recovers the useful parts as an independent foundation: shared rules and non-app
configs land now, while the root config keeps serving the three apps.

## Decisions

- One shared rule module, `platform/eslint-rules.mjs`, holds no project file paths; each config owns its patterns and
  globals.
- Shared-rule consumers are the configs that exist in the checkout. With no app config in this PR, no app is selected.
- A root-config edit keeps the whole-plan selection while the apps use it. An app config edit selects its app folder,
  whose workflow owns that app's browser shards; there is no lint-only folder in the planner.
- Pre-commit selects a staged file's own config when present and the root config with unchanged paths otherwise.

## History

- 2026-11-27: Web migrated to its own config, so all nine linting projects consume the shared rules and the root config
  was retired. Platform's root-config probe became a check of its own config; Web's lint-config test carries the app
  probes. The planner maps a retired-root-config change to platform instead of the whole plan. (#456)
- 2026-11-26: Compliance review restored lint coverage of the root config and every migrated project config, replaced
  the one-use configPath helper with a local path, ordered this History newest first, and proved the shared-rule guard
  test catches a disabled guard on a scratch copy. Effective-rule equivalence was already proved for linted files; this
  change is about which files the owning commands enumerate. (#475)
- 2026-11-26: Lead review corrected the transitional dependency: the root config imports ESLint's own presets, not the
  shared module, and its app rules may duplicate future shared rules until app migrations and root cleanup. It also
  moved consumer discovery tests to scratch fixtures and took synthetic regex probes out of production tooling. (#475)
- 2026-11-26: #475 restores the root config and Platform's root-config readability test, keeps PR #466's shared rules,
  non-app configs and Makefiles, and adds pre-commit fallback with focused tests. Why: the owner asked for a foundation
  that touches no app and for no weakening of CI selection. (#475)
- 2026-11-26: PR #466's review proposed a stack: shared tooling first, then one PR per app, then root-config removal.
  The owner allowed one PR for the projects without browser suites and kept the CI time budget unchanged. (#466, #475)
