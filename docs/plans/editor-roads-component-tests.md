# Task: Editor roads component tests

Issue: `#476`, part of `#455`. The issue and its sub-issues hold scope, status and dependencies; this plan holds their
history.

## Context

The Editor's roads browser tests each started the whole app, loaded the pinned source bundle and basemap archive, and
repeated the same startup before checking one component. ADR [0040](../decisions/0040-tests-next-to-their-code.md) puts
tests next to the code they test; this pilot applies it to roads without changing what the tests prove.

## Decisions

- The component harness mounts the real roads, junction and inspector modules on a bare MapLibre map with a small local
  style, served from the Editor's own origin. It never loads `app.js`, the full source bundle or the basemap archive.
- Production seams are extracted only where the host supplied state to layer behaviors and junction features: the
  behavior context, shown-level filters and working-feature lookup. Both `app.js` and the harness call the same code.
- Logic that needs no browser moves to source-owned unit tests; browser-only behavior stays in
  `src/layers/roads/roads.browser.test.js`. The draw, split, join and export journey stays whole-app because it covers
  startup and pick helpers the harness deliberately stubs.
- The harness uses the Editor's fixture city, not source contents from the repository HEAD. Roads cases keep their
  desktop-only skip on `pages-mobile`.
- No new decision record: this implements the accepted layout in ADR 0040.

## History

- 2026-11-26: replaced six repeated whole-app roads cases with colocated component browser tests and unit tests for the
  extracted seams, kept one full-app journey in `e2e/`, and recorded proof that each replacement fails on a realistic
  code mutation. The 11 mutation diffs and full failure logs are under `/tmp/task476/proofs/`, indexed by
  `run-corrected.log`. (#476)
