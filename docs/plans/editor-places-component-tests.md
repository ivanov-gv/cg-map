# Task: Editor places component tests

Issue: `#455`. The issue holds scope, status and dependencies; this plan holds the history of its places slice.

## Context

The Editor's places cases each started the whole app, loaded the pinned source bundle and basemap archive, and repeated
that startup before checking one place. ADR [0040](../decisions/0040-tests-next-to-their-code.md) puts tests next to the
code they test, and the roads and buildings slices showed how to mount a real component on a bare map without `app.js`.
This step applies the same layout to places without changing Editor behavior.

## Decisions

- `tests/e2e/support/places-harness.mjs` routes a small HTML document from the Editor's own origin and mounts the real
  places behavior, inspector, edit session, changeset and overlays on a bare map. Buildings are read as context through
  `entriesOf`; they are not drawn or picked. The harness never loads `app.js`, the full source bundle or the basemap
  archive.
- Browser-free building lookup and placement rules live in `src/layers/places/layer-places.test.js`. The only production
  change is exporting the existing `placedFeature`; no behavior changed.
- Three desktop-only cases live in `src/layers/places/places.browser.test.js`. One whole-app journey stays in
  `e2e/places.spec.js`: it covers startup, phone marking and desktop deletion/undo, and a real export → discard →
  import. The component cases cover fields, hours, local identity, building membership, undoing a source deletion and
  relative drags without that startup.
- The component delete/undo case runs before the relative drag, so undo returns the session to zero changes. After undo
  it reselects the source place with `selectPlace(page, false)`; the default would toggle the already-chosen places
  layer.
- Every assertion removed from the whole-app specs is mapped to a new home below; none was dropped or loosened.
- No new decision record: this follows the accepted layout in ADR 0040.

## History

- 2026-11-28 (round 2): an independent review found that `origin/main` asserted that choosing `Add place` hides
  `.inspector`, while the named replacement only started drawing. The component harness does render the inspector, so
  the new-place case now selects a source place first, checks the inspector is visible, starts `Add place`, and checks
  it is hidden. Rechecked every removed-assertion row against
  `git diff origin/main...HEAD -- apps/editor/tests/e2e/editing.spec.mjs apps/editor/tests/e2e/addresses.spec.mjs`:
  `two drags add one change` is an assertion added by the component case, not a removed one; the table now also names
  `changeset.bases`, the hidden editor on desktop delete, and null `before`, and the drag mutation line number follows
  the inserted assertions. `free -h` showed 14 GiB total and 6.9 GiB available before the verify and browser runs. From
  the root, `make verify PKG=apps/editor` passed **421 tests**, **0 failures**. The changed specs passed with
  `E2E_WORKERS=2`:

  ```sh
  npx playwright test --project=root-desktop src/layers/places/places.browser.test.js tests/e2e/addresses.spec.mjs tests/e2e/editing.spec.mjs e2e/places.spec.js
  ```

  → **59 passed, 2 skipped (7.3m)**.

  ```sh
  E2E_PHONE=tagged npx playwright test --project=pages-mobile src/layers/places/places.browser.test.js tests/e2e/addresses.spec.mjs tests/e2e/editing.spec.mjs e2e/places.spec.js
  ```

  → **16 passed (1.6m)**. In the disposable copy `/tmp/opencode/cg-map-places-inspector-proof`, replacing
  `if (transaction.tool) this.#context.hideInspector();` with `if (false) this.#context.hideInspector();` in
  `src/inspector/inspector-editing.js:504` failed the new case with `.inspector` expected hidden and received visible at
  `places.browser.test.js:108`; the copy was deleted afterwards. (#455)

- 2026-11-28: moved four whole-app places cases into three colocated component browser tests plus a browser-free unit
  test, retained one whole-app journey, and recorded below where every removed assertion now lives. From `apps/editor`,
  `npm run lint` passed and `make -C apps/editor build` passed (`Built dist/editor/ (release 828813f14827fa1f)`). From
  the repository root, `make verify PKG=apps/editor` passed with **421 tests**, **0 failures**
  (`verify apps/editor: OK`). `free -h` showed 14 GiB total and 6.9 GiB available before the verify run, and 6.2 GiB
  available before the browser runs. (#455)

  Browser declarations and shards were counted with `E2E_WORKERS=2 E2E_PHONE=all npx playwright test --list` and
  `E2E_WORKERS=2 E2E_PHONE=tagged npx playwright test --list`, then with `--shard=i/15` for every `i` from 1 to 15 in
  each mode. No browser job was added: `browser-jobs.json` stays at 15.

  | Declaration count                 | Before                             | After                                   |
  | --------------------------------- | ---------------------------------- | --------------------------------------- |
  | `E2E_PHONE=all`, both projects    | `Total: 248 tests in 15 files`     | `Total: 248 tests in 17 files`          |
  | `E2E_PHONE=tagged`, both projects | `Total: 165 tests in 15 files`     | `Total: 164 tests in 17 files`          |
  | `all` per shard                   | 17 tests on shards 1–8, 16 on 9–15 | 17 tests on shards 1–8, 16 on 9–15      |
  | `tagged` per shard                | 11 tests on each of the 15 shards  | 11 tests on shards 1–14, 10 on shard 15 |

  The file count rose by two because the component spec and the retained journey are new files. The tagged total fell by
  one because two tagged whole-app cases became one tagged journey; the three component cases are desktop-only and do
  not add mobile declarations.

  The changed specs passed with `E2E_WORKERS=2` on 16 CPUs (AMD Ryzen 7 5700U with Radeon Graphics, 14 GiB memory):

  Desktop:

  ```sh
  npx playwright test --project=root-desktop src/layers/places/places.browser.test.js tests/e2e/editing.spec.mjs tests/e2e/addresses.spec.mjs e2e/places.spec.js
  ```

  → **59 passed, 2 skipped (7.9m)**. Phone:

  ```sh
  E2E_PHONE=tagged npx playwright test --project=pages-mobile src/layers/places/places.browser.test.js tests/e2e/editing.spec.mjs tests/e2e/addresses.spec.mjs e2e/places.spec.js
  ```

  → **16 passed (1.5m)**.

  Each mutation below was applied alone in the disposable copy `/tmp/opencode/cg-map-places-proof` and observed to fail;
  the copy was deleted afterwards. Attempts that passed were not counted as proof.

  | Mutation in the disposable copy                                                       | New test that failed                                                                  | Exact failure                                                                                                               |
  | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
  | `buildingAt` returns the first containing building                                    | `buildingAt takes the smallest building where footprints overlap`                     | `'way/1' !== 'way/2'` at `layer-places.test.js:42`                                                                          |
  | `placedFeature` leaves the new in-building place unchanged                            | `a new place says which building it is in, or that it stands alone`                   | missing `buildingEntityId: 'way/2'` at `layer-places.test.js:50`                                                            |
  | `placedFeature` leaves the moved outside-building place unchanged                     | `a moved place changes building, while an untouched one keeps what it says`           | missing `standalone: true` at `layer-places.test.js:58`                                                                     |
  | `placedFeature` recomputes an untouched place                                         | `a moved place changes building, while an untouched one keeps what it says`           | `buildingEntityId: 'way/2'` instead of `'way/9'` at `layer-places.test.js:62`                                               |
  | Hours dialog's Done calls `onDone('')`                                                | `a place keeps its details and hours through the changeset`                           | `[name="opening_hours"]` expected `"Mo-Fr 08:00-22:00; Sa-Su,PH 10:00-18:00"`, received `""` at `places.browser.test.js:81` |
  | A drag moves to the press point plus the offset, instead of from where it was pressed | `a source place can be deleted and undone, and moves by relative drags with no ghost` | `.inspector` expected hidden, received visible at `city-steps.mjs:88` via `places.browser.test.js:175`                      |

  Assertions removed from `tests/e2e/editing.spec.mjs` and `tests/e2e/addresses.spec.mjs`, and where they are checked
  now:

  | Removed assertion(s)                                                                                                                                                                                                                                                            | New home                                                                                                                                                                                                                                                                                                                                                                          |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | From `POI details round trip through export, and import resumes them on a clean session`: `places.geojson · 1 change`, only `places.geojson` in `bases`, one modified operation with source reference, unchanged `before` and geometry, and `name`/`visibilityLevel` in `after` | `e2e/places.spec.js` → `a source place can be deleted or marked and undone, and its details survive export and import` for the whole-app path; `src/layers/places/places.browser.test.js` → `a place keeps its details and hours through the changeset` for `{entityId: 'node/20'}`, the modify operation, unchanged `before`/geometry and `name`/`visibilityLevel: 2` with hours |
  | From the same test: discard returns `#review-empty`, import restores `places.geojson · 1 change`, and `#review-message` says `Imported 1 changes`                                                                                                                               | `e2e/places.spec.js` → `a source place can be deleted or marked and undone, and its details survive export and import`                                                                                                                                                                                                                                                            |
  | From `a POI moves by relative drags from anywhere, with no jump and no ghost`: no feature at the old point, exported properties match the building under the new point, and the coordinate moves by the pixel offset                                                            | `src/layers/places/places.browser.test.js` → `a source place can be deleted and undone, and moves by relative drags with no ghost`                                                                                                                                                                                                                                                |
  | From the same test: an open edit disables export                                                                                                                                                                                                                                | `tests/e2e/editing.spec.mjs` → `an open edit blocks export, import and discarding until it is applied or cancelled` and `losing the window in the middle of a drag restores the preview` keep the whole-app assertion; the component case checks the change count stays hidden until Apply                                                                                        |
  | From `a new POI gets a local identity, and deleting or marking a source POI can be undone`: phone mark button text, hidden editor, `Marked for deletion` toast and field item, one change, toast undo, empty field list and review, and restored status                         | `e2e/places.spec.js` → `a source place can be deleted or marked and undone, and its details survive export and import`                                                                                                                                                                                                                                                            |
  | From the same test: hidden editor, desktop delete summary, undo, empty review and restored status                                                                                                                                                                               | `e2e/places.spec.js` → `a source place can be deleted or marked and undone, and its details survive export and import`; `src/layers/places/places.browser.test.js` → `a source place can be deleted and undone, and moves by relative drags with no ghost` checks the dialog, toast, one change, undo and an empty changeset                                                      |
  | From the same test: `Add place` draw choice, hidden inspector, required `category` and `visibilityLevel` errors, and an added operation with `local:` reference and ID, `source: 'Local correction'`, no `osm_id`, `visibilityLevel: 4`, and null `before`                      | `src/layers/places/places.browser.test.js` → `a new place needs its fields, gets hours, and belongs to the building it is moved onto`                                                                                                                                                                                                                                             |
  | From `a place is added with its hours and belongs to the building it is moved onto`: standalone hint, name/category/kind/visibility fields, preset and edited opening hours, move hint and target layer, `way/2` membership, no `standalone`, and exact `[2, 2]` geometry       | `src/layers/places/places.browser.test.js` → `a new place needs its fields, gets hours, and belongs to the building it is moved onto`                                                                                                                                                                                                                                             |
