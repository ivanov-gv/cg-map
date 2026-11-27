# Task: Editor buildings component tests

Issue: `#455`. The issue holds scope, status and dependencies; this plan holds its history.

## Context

The Editor's buildings browser cases each started the whole app, loaded the pinned source bundle and basemap archive,
and repeated the same startup before checking one component. The moved-building case timed out at 90 s twice in CI (runs
for #483 and #496). ADR [0040](../decisions/0040-tests-next-to-their-code.md) puts tests next to the code they test; the
roads pilot (`editor-roads-component-tests.md`) showed how to mount real components on a bare map without `app.js`. This
step applies the same layout to buildings without changing what the tests prove.

## Decisions

- `tests/e2e/support/buildings-harness.mjs` routes a small HTML document from the Editor's own origin and mounts only
  buildings, entrances, places, the inspector and the overlays. It never loads `app.js`, the full source bundle or the
  basemap archive. The harness reads the Editor's fixture city and its own layer rules.
- Two whole-app cases become colocated browser tests in `src/layers/buildings/buildings.browser.test.js`, which start
  the component instead of the app. One whole-app journey stays in `e2e/buildings.spec.js`: it covers startup, draw,
  field entry, reload into Browse and changeset export. Desktop-only skips remain on `pages-mobile`.
- Browser-free entrance numbering is covered by a unit test beside `layer-buildings.js`. The only production change is
  exporting the already-present `nextEntranceNumber`; behaviour is unchanged.
- Two whole-app assertions that do not depend on a component move into the retained journey: an empty `#review-problems`
  after the first apply, and returning to Browse with the buildings layer chosen after reload. The draft-restoration
  assertion in the harness uses `EditSession.exportDraft()` / `restoreDraft()` instead.
- The harness processes every pointer move, while the whole app under load dropped the last two moves of the five-step
  drag that put an entrance corner near its neighbour. The harness therefore drags that corner to `[0.75, 2.6]`, still
  clear of the other house, so the magnet-off and magnet-on steps assert the same geometry and outcomes as before.
- No new decision record: this follows the accepted layout in ADR 0040.

## History

- 2026-11-27: moved two buildings cases out of the whole-app spec into colocated component browser tests, kept one
  whole-app journey, added the `nextEntranceNumber` unit test, and recorded below which removed assertion now lives
  where. Test declarations stayed at **244** (`122` per project) before and after; the file count went from 13 to 14
  because the harness spec is a file. On 16 CPUs (AMD Ryzen 7 5700U with Radeon Graphics, 14 GiB memory, `free -h`
  showing at least 4.1 GiB available before each browser run), `E2E_WORKERS=1` with the default `swiftshader` backend
  passed the three `root-desktop` cases in 56.3 s; `E2E_WORKERS=2` across both projects passed 3 and skipped 3 in 37.8
  s. `make verify PKG=apps/editor`: 366 tests, 0 failures. `npm run lint` and `make -C apps/editor build` passed. Each
  mutation below was applied alone in a disposable copy outside the worktree and observed to fail; the copies were
  deleted afterwards. (#455)

  | Mutation in the disposable copy                                                   | New test that failed                                                                                   | Exact failure                                                                                                                                                                |
  | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `nextEntranceNumber` returns `'1'`                                                | `a new entrance gets the next number after the ones already on the building`                           | `Expected values to be strictly equal: '1' !== '3'` at `layer-buildings.test.js:158`                                                                                         |
  | `belongingEdits` returns `[]` (entrance and place do not follow a moved building) | `a moved building takes everything with it in one step, and its removal asks about the place inside`   | `locator('#change-count')` expected `"4"`, received `"2"` at `buildings.browser.test.js:56`                                                                                  |
  | `magneticallyMoved` returns the geometry unchanged                                | `a building is drawn and moved against its neighbour, and an overlap is said and shown`                | `expect(received).toEqual(expected)`: expected `[-1,1],[1,1],[1,3],[-1,3],[-1,1]`, received `[-1.1,1],[0.9,1],[0.9,3],[-1.1,3],[-1.1,1]` at `buildings.browser.test.js:165`  |
  | `placedFeature` never sets `buildingEntityId`                                     | retained whole-app `a building is drawn, described, given an entrance and a place, and exported whole` | `locator('#inspector-extras')` expected substring `"New barber"`, received `"Entrances · 1Entrance 116Add entrancePlaces inside · 0Add place"` at `e2e/buildings.spec.js:48` |

  Assertions removed from `tests/e2e/buildings.spec.mjs` and where they are now checked:

  | Removed assertion(s)                                                                                                                                                                                                                                                                                                  | New home                                                                                                                                                |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | A moved building is titled `Main street 14`, makes 4 changes, undo hides the count, deleting asks about `Corner cafe`, the pick prompt appears, and the changeset deletes building, label and entrance while modifying the place to `way/2` (`a moved building takes everything with it…`)                            | `src/layers/buildings/buildings.browser.test.js` → `a moved building takes everything with it in one step, and its removal asks about the place inside` |
  | `#review-problems` is empty after the first apply (`a moved building takes everything with it…`)                                                                                                                                                                                                                      | `e2e/buildings.spec.js` → `a building is drawn, described, given an entrance and a place, and exported whole`                                           |
  | The first corner snaps with the magnet on, the ring closes, the zoom-17 corner move snaps, overlaps are said and shown then cleared on cancel, the switch survives reload, a whole building keeps its shape and goes to its neighbour's corner, and the exported corners are exact (`a building is drawn and moved…`) | `src/layers/buildings/buildings.browser.test.js` → `a building is drawn and moved against its neighbour, and an overlap is said and shown`              |
  | Reload returns the whole app to Browse with the buildings layer chosen (`a building is drawn and moved…`)                                                                                                                                                                                                             | `e2e/buildings.spec.js` → `a building is drawn, described, given an entrance and a place, and exported whole`                                           |
