# 0044: Build-derived Web shell inventory

## Status

Accepted.

## Context

The service worker needed an explicit list of every Web runtime module, map-core module, font and local asset. A new
nested module would miss that list, and a hand-maintained copy of the artifact tree could silently include host config,
generated manifests or downloaded archive ranges. The import-boundary checks lived in Platform as another per-file list,
so a new Web module also needed a Platform edit.

## Decision

Web derives its offline shell from the built artifact. `apps/web/tools/offline-shell.mjs` walks `dist/web` in sorted
order, includes shipped runtime modules and local assets, and excludes `.nojekyll`, `config.json`, generated manifests,
`sw.js`, test/support files, PMTiles archives, partial downloads and other range payloads. `assertShellIncludesModules`
still requires every runtime module discovered by `apps/web/tools/runtime-modules.mjs` to appear in the shell; the
service worker stays outside the cached list but inside the shell hash. The manifest keeps its own path in the shell and
the verified archive remains content-addressed, so a failed replacement cannot remove a completed download.

`apps/web/tools/build.mjs` copies `src/` recursively, leaves colocated tests and support directories out, and rewrites
only the published map-core import at each destination's relative depth. Web owns the runtime import, dynamic-import and
gesture checks that Platform used to keep in its per-file list.

## Consequences

Adding a runtime module, an asset or a feature folder no longer needs a list edit, and tests cannot enter the shipped
artifact. A deterministic walk changes the shell's cache name when file ordering or content changes; that installs a new
shell before replacing open tabs, without clearing OPFS or the verified archive. Shell discovery must keep its exclusion
rules under test, because a too-wide extension rule would put host config or range responses in the cache. Current
behavior lives in the [web guide](../../apps/web/README.md) and the
[architecture](../system-architecture/architecture.md).

## Outcome note (2026-11-26)

A follow-up review found two ways the original implementation could pass its own fixture while breaking a real build: a
broad `./map-core/` rewrite also changed local sibling paths and ordinary asset strings, and a scratch project that
linked the repository root's `node_modules` resolved map-core from the workspace HEAD instead of Web's published `0.2.0`
pin. The accepted decision is unchanged: `build.mjs` now relocates only published map-core import specifiers at the
destination depth, and scratch projects resolve dependencies through Web's installed package tree. Implementation
mutations under `/tmp/opencode/proof-477/implementation/` run the committed tests against broken production guards and
manifest invariants, so each failure is attributable to the implementation rather than to a mutated input fixture.
