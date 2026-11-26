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
  code mutation. The mutation proofs ran in disposable copies, one at a time; their failure summaries are recorded in
  the runtime entry below. (#476)
- 2026-11-26: review round moved the remaining host logic into `src/layers/roads/roads-host.js`, imported by both
  `app.js` and the component harness, and kept one level step and one joint tap in the whole-app journey to cover the
  host's own call sites. Runtime check on `root-desktop` with `E2E_WORKERS=1` and `E2E_ANGLE=swiftshader`, on 16 CPUs
  (AMD Ryzen 7 5700U with Radeon Graphics, 14 GiB memory): before on `origin/main`, seven whole-app roads cases passed
  in 2.1m (131.82 s wall). A round-2 review then added unit proofs for `isPickableEntry` and the `app.js` binding, a
  directory assertion at Level `-1`, the restored closing step of the harness level case, and direct `featureForEntry`
  imports; it also removed the duplicate guards from `app.js`. After those changes, six colocated cases plus the
  whole-app journey passed in 1.5m (90 s wall) under the same settings. `make verify PKG=apps/editor`: 356 tests, 0
  failures. Each mutation below was applied alone in a disposable copy and observed to fail; attempts that passed are
  not counted as proof. (#476)
  - `isPickableEntry` replaced by `() => true` in `roads-host.js`: both `roads-host.test.js` tests failed.
  - `const isPickable = entry => isPickableEntry(entry, activeLayer)` replaced by `() => true` in `app.js`: the `app.js`
    binding test failed, while the shared-rule test still passed.
  - `pickableEntries` given `shownLevel: null` in `app.js`: the whole-app case failed
    `expect(page.locator('#objects-list')).not.toContainText('Side street')` at Level `-1`.
  - The `jointOnShownLevel` filter removed from `roadsJointsToShow`: the harness level case failed its joint-coordinate
    assertion after switching to Level `-1`.
  - The `entryOnShownLevel` filter removed from `roadsPickableEntries`: the harness level case failed
    `expect(page.locator('.inspector')).toBeHidden()` when the ground road was tapped at Level `-1`.
  - Road hits given priority over the joint in `roadsClickTarget`: the harness junction case failed with
    `#selection-title` showing `Main street` instead of `Main street × Side street`.
  - `roadsJointsToShow` given `shownLevel: null` at the remaining `app.js` call site: the whole-app case failed its
    joint-status assertion under Level `-1`.
  - `roadsClickTarget` given `jointLayer: {jointAt: () => null}` at the remaining `app.js` call site: the whole-app case
    failed with `#selection-kind` showing `Road · Residential` instead of `Junction`.
  - Only computing hits before the joint lookup, without changing priority, was also tried and passed. It is recorded
    here as a rejected proof attempt, not as a mutation proof.
