# Task: `Web tests next to their components`

Issue: `#456`. The issue and its sub-issues hold scope, status and dependencies; this plan holds their history.

## Context

Web keeps runtime modules in one flat folder, browser tests in one spec and three per-file lists: browser areas, allowed
imports and offline files. Moving sources beside their tests needs the build and checks to derive those facts instead of
naming files. The owner approved the staged layout and browser-time target on 2026-11-25; #477 finishes the first
bounded step without moving application sources.

## Decisions

- Web owns its runtime import, dynamic-import and MapLibre gesture checks in `apps/web/tools/runtime-modules.mjs`.
  Platform no longer keeps a Web file list or those source checks.
- `apps/web/tools/build.mjs` copies runtime sources recursively and rewrites the published map-core import at the
  destination's depth. `apps/web/tools/finalize.mjs` derives the shell from the built artifact instead of a list.
- The shell excludes host config, generated manifests, archive/range responses, colocated tests and support files.
  `sw.js` stays outside the cached shell but remains in its hash.
- Platform still selects Web builds for hosting and package checks. Removing that CI dependency waits until the
  remaining hosting, Makefile and package checks no longer read Web files at HEAD.

## History

- 2026-11-26: Stacked this step after its formal `#475` blocker, which added the lint foundation and ADR 0043. The Web
  decision record moved from 0043 to 0044 and its authored links were updated. Why: the stack keeps decision numbers
  contiguous and leaves the root-config transition with its owning task. (#477)
- 2026-11-26: recorded that Web modules and the offline shell are discovered from the build, with a decision record for
  the build-derived inventory. Why: the first step is complete before any source folder moves. (#477)
- 2026-11-26: created this plan from the approved step order. Why: the lists/harness step is uncommitted work on
  `platform/456-web-lists` and its choices need a history beyond issue comments. (#477)
