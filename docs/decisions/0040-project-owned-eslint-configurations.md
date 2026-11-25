# 0040: Project-owned ESLint configurations

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
[platform/eslint-rules.mjs](../../platform/eslint-rules.mjs), which names no project file. The root config is gone.

The planner gives a project's own config that project's verify; the shared rules select the verify of every project that
imports them. Neither selects a Web browser area: lint rules cannot change what a browser does. The readability probe
lives with the web project whose config it checks, so that probe reads only its own project's files. Editor and
core-demo keep the folder rules they have today for their configs.

## Consequences

- Adding a new kind of file in a project needs only that project's config; no project changes another's lint scope.
- A shared rule change runs the verify of all nine importing projects, but no browser suite. A rule that applies to only
  one project's files still stays in that project's config, which selects only that project's verify.
- The new dev dependency is recorded in
  [architecture](../../docs/system-architecture/architecture.md#independent-projects), so the planner knows its
  consumers without reading configs.
- Every project keeps linting the files it linted before; the lint config files themselves are linted by their owners.
