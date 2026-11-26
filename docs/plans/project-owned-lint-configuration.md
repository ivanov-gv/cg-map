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

- 2026-11-26: #475 restores the root config and Platform's root-config readability test, keeps PR #466's shared rules,
  non-app configs and Makefiles, and adds pre-commit fallback with focused tests. Why: the owner asked for a foundation
  that touches no app and for no weakening of CI selection. (#475)
- 2026-11-26: PR #466's review proposed a stack: shared tooling first, then one PR per app, then root-config removal.
  The owner allowed one PR for the projects without browser suites and kept the CI time budget unchanged. (#466, #475)
