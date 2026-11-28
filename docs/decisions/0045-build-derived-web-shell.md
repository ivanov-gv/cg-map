# 0045: Build-derived Web shell inventory

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
gesture checks that Platform used to keep in its per-file list. Per-folder rules in `apps/web/tools/runtime-modules.mjs`
name which feature folders a module may import from. Modules that existed on main keep their reviewed imports
transitively, and every module with no local imports on main (for example `shared/core.js` and `shared/dom.js`) may not
gain any.

## Consequences

Adding a runtime module, an asset or a feature folder no longer needs a list edit, and tests cannot enter the shipped
artifact. A deterministic walk changes the shell's cache name when file ordering or content changes; that installs a new
shell before replacing open tabs, without clearing OPFS or the verified archive. Shell discovery must keep its exclusion
rules under test, because a too-wide extension rule would put host config or range responses in the cache. Current
behavior lives in the [web guide](../../apps/web/README.md) and the
[architecture](../system-architecture/architecture.md).
