# Task: implement stable POI visibility levels

Status: implemented; device density review and the decisions under Progress remain open.

## Goal and acceptance criteria

Implement [stable POI visibility](../ui-ux/features/poi-visibility.md), serving US-02, US-03, and US-04.

- Every directory place receives a fixed visibility level, with inclusive and cumulative zoom thresholds. Eligible icons
  no longer disappear when collision placement changes during a small pan or scroll.
- Names remain optional; geographic anchors, identity, selection, search, the stable dock/mobile bubble, and offline
  integrity remain intact. Same-location and multiple-hit selection must keep every listing reachable.
- Supply deterministic defaults and reviewed per-place overrides. Provide the configuration mechanism for earlier
  visibility without implementing payments or activating commercial customers.
- Scope: shared place/config contracts, data metadata production/validation, web rendering/selection, tests, and docs.
  No backend API, dependency upgrade, geography refresh, or PMTiles rebuild. Place metadata and provenance may change
  deliberately; geometry may not.

## Decisions

### Findings from the current implementation

- [core.js](../../apps/web/src/core.js) has `PLACE_SCALE_FILTER`: sights/essentials from zoom 13, other categories from
  zoom 14. This is category eligibility, not per-place rank.
- [app.js](../../apps/web/src/app.js) combines icons and names in `place-symbols`; changing collision placement can
  suppress eligible icons. `search-place` protects only one requested result. `updatePlaceLayers()` also bypasses the
  default filter while a preview exists; replace that conditional carefully so a preview alone cannot expose all POIs.
- App startup assigns numeric feature IDs from input array indices. Overrides, ordering, and tests must use stable
  `properties.id`, not those indices. Migrate source feature IDs and dependent selection/highlight paths together.
- [places.schema.json](../../packages/contracts/places.schema.json) currently contains identity/name/category/point
  constraints. [check-data.mjs](../../data/tools/check-data.mjs) performs explicit validation; editing the JSON schema
  alone will not enforce new fields.
- [build.mjs](../../apps/web/tools/build.mjs) copies the place snapshot unchanged. The OSM extractor replaces snapshots;
  persistent overrides must live separately and be reapplied after an intentional import.

### Rendering approach

Use the feature document as the authoritative level table and behavior policy. Implement separate icon-only and
name-only layers over the same directory source. Icons must not be suppressed by text or icon collision placement; names
use the existing collision system and preserve road/address priorities. Do not solve this by setting both icon and text
overlap to true on the existing combined layer.

For the vendored MapLibre GL JS 5.12.0, verify an icon-only layer with `icon-allow-overlap: true` and
`icon-ignore-placement: true`, plus explicit stable source ordering, and separate collision-aware names. The
[official symbol specification](https://maplibre.org/maplibre-style-spec/layers/#icon-allow-overlap) documents these
placement controls; its [ignore-placement](https://maplibre.org/maplibre-style-spec/layers/#icon-ignore-placement) and
[text-optional](https://maplibre.org/maplibre-style-spec/layers/#text-optional) rules explain why names and markers must
be tested independently. Verify the actual vendored version, not just the latest online specification.

Prefer one icon layer per level with `minzoom` from the shared configuration and no `maxzoom`, or an equivalent
continuous-zoom predicate demonstrated by browser tests. This avoids relying on integer-only filter evaluation for
fractional thresholds. The initial thresholds are integers; test fractional values around them. Do not rebuild the
GeoJSON source on every camera movement. Never derive admission from `queryRenderedFeatures()` or viewport occupancy.

Use a total order based on effective level and a code-point comparison of stable ID. Make higher-priority overdraw
consistent and independent of input order, screen size, and camera bearing. Define the numeric draw-order conversion
explicitly when using `symbol-sort-key`; overlap drawing order is not the same as collision-admission priority. Audit
all references to `place-symbols`, `search-place`, and place highlights when splitting layers.

### Data and contract approach

1. Add one versioned level configuration in `packages/contracts/` containing the level-to-zoom table and compatible
   schema/constraints. Data produces metadata; web consumes the published result/config. Neither imports the other's
   runtime code. Copy the configuration as a local runtime asset if the consumer needs it; do not duplicate thresholds
   in separate producer and consumer constants.
2. Add a reviewed metadata policy and stable-ID override file under `data/sources/`, separate from OSM geographic facts.
   Defaults follow the feature document's kind/category precedence. Each override records ID, level, reason, and
   editorial provenance. Reject unknown/duplicate IDs and unsupported levels; leave commercial entries inactive.
3. Add a small data-owned metadata command to apply the policy to the existing place snapshot without reimporting OSM.
   Write `properties.visibilityLevel` for every published place. Keep the override file across future extraction; make
   the deliberate import workflow reapply it rather than losing it. Preserve coordinates, listing count, IDs, existing
   attributes, source/license, and geometry hashes. Review the changed place hash/provenance deliberately.
4. Extend the shared place schema additively for `visibilityLevel` and update the manual producer validator and tests.
   New published snapshots must contain valid levels on every entry. Legacy inputs missing the field may normalize to
   level 5 for compatibility; present-but-invalid values must fail validation visibly, not silently become high
   priority. Keep producer enforcement distinct from the documented legacy consumer fallback.
5. The web build validates/copies the enriched snapshot and level configuration. Include every new runtime asset/module
   in the owning offline inventory and import allowlist. Keep archive bytes unchanged. Existing verified downloads
   remain usable if a new shell/download fails; do not migrate or discard OPFS data for this metadata change.

### Density and overlap limits

Removing collision suppression alone can create piles of icons. Start with the current 22 CSS-pixel icon footprint;
review actual density before release. Assign lower-priority places later levels through persistent policy/overrides, not
viewport quotas or dynamic thinning. No normal business may be promoted into country-scale landmark visibility.

For exactly co-located listings, form deterministic groups from equal published coordinate pairs, without rounding
additional points together or changing coordinates. At each threshold/filter, render one shared marker for the eligible
members and open a listing chooser on selection. A single eligible member uses its normal category marker. Grouping does
not merge directory identities. Derive the group identity from all co-located stable IDs, independently of active
filters/levels; expose the active member IDs on its rendered feature for selection and acceptance assertions. Nearby
distinct markers need deterministic multiple-hit selection too. Reuse the existing details/selection surface where
practical; add no permanent legend or explanation panel.

If real data still creates unreadable overdraw after documented level tuning, report the concrete scenes as a blocker.
Do not silently reinstate collision-based icon admission or claim every co-located listing gets a separate readable
screen pixel. Threshold tuning must remain fixed for the release and keep the cumulative property.

### Search and selection

- Keep query/category filtering separate from default level admission. Matching icons retain their assigned thresholds;
  only the selected listing, or otherwise the leading requested result, has a single protected exception below its
  threshold. Replace the current blanket filter bypass: a broad query/category must not force all matches onto the map.
- Clearing a filter removes its preview exception. Selected features remain represented below their ordinary threshold
  until closed. Cover both point-only POIs and places that highlight buildings; avoid duplicate icons across
  normal/search/selected layers. Closing selection restores the correct default state and focus.
- Keep nearest-result ordering and the 40-result list limit separate from map admission. Off-screen matching data must
  remain searchable. Preserve route-point/transport-stop hit precedence and actual From/To coordinates.

## Implementation sequence and ownership

1. **Contracts + data:** implement the shared configuration, metadata policy/overrides, producer command, validation,
   reviewed place-only migration, fixtures, and producer/consumer contract cases together. Update data runbook and
   source provenance. This is an explicit cross-boundary change; do not postpone consumer compatibility to a different
   release.
2. **Web policy + rendering:** normalize stable IDs/levels, replace category admission, split icon/name layers, add
   stable ordering, retain special search/selection visibility, and register local runtime/offline assets. Own changes
   in `apps/web/src/`, `apps/web/tools/`, and the runtime allowlist in `platform/tools/check-repo.mjs` where needed.
3. **Selection:** implement co-located/multiple-hit choice with real identities and accessible controls. Update
   `apps/web/src/object-selection.js` integration and browser helpers that currently search for collision-placed
   symbols.
4. **Acceptance + density:** add the ID-based tests below, inspect real density, tune documented assignments once, run
   required final checks, and obtain the repository-required compliance review. Mark feature docs implemented only after
   evidence exists. Keep commercial service implementation outside this change.

## Verification

Results are under [Progress](#progress). The implementation added tests for each area:

| Area          | Required evidence                                                                                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment    | Exact kind/category precedence, unknown fallback, ID overrides, invalid/duplicate/orphan overrides, exhaustive published coverage; no changed coordinates/counts/geography.                                                                   |
| Boundaries    | For every level, icons absent at `threshold - 0.01`, present at equality and `+0.01`; earlier levels remain at later levels. Reverse the path and compare the same ID sets.                                                                   |
| Stability     | Fixtures span tile boundaries and dense labels. Compare expected stable IDs at small zoom increments, 1–20px pans, camera round trips, bearing changes, reloads, and reordered input. Keep tested anchors well inside the viewport.           |
| Labels        | Create deliberate name/address collisions; the expected icon IDs remain rendered even when their names cannot be placed. Assert the icon-only layers, not a combined layer hit returned by text.                                              |
| Screens       | The same interior POIs at the same zoom/query have identical eligibility on 412×840 and desktop. Screen size changes visible geography, not assigned levels.                                                                                  |
| Overlap       | Equal-coordinate fixtures across different levels/categories; exact active count and chooser membership, accessible selection/focus, preserved details and real From/To coordinates. Nearby overlapping points remain individually reachable. |
| Overrides     | Giving one fixture an earlier level changes only its threshold; other POIs keep their assignments and displayed membership, and search order is unaffected. No commercial override is active in shipped data.                                 |
| Interaction   | Search/category exceptions, active-category untoggle, clearing filters, selected-below-threshold, no duplicate markers, building highlights, satellite/transport toggles, and fixed mobile categories/midpoint results remain correct.        |
| Broad filters | At country zoom with a broad query/category, compare exactly the eligible matching set plus one selected/leading exception; do not render all matches. Selecting another result moves that exception, and clearing restores normal admission. |
| Offline       | Metadata/config are local shell assets at both hosting paths; reload offline gives the same ID sets; failed replacements preserve the verified archive; no new network/editorial dependency.                                                  |
| Appearance    | Real central Podgorica plus a second dense area and a sparse/coastal area, at every threshold on phone/desktop; readable roads, addresses, paths, location, and POIs. Save screenshots and report unresolved density honestly.                |

Use rendered stable feature IDs for browser assertions and explicit expected sets, expanding shared-marker active
membership to original place IDs when comparing represented listings. Do not rely only on counts or style-property
assertions. Reorder the same fixture without changing expected identities. Do not remove old scale/offline/selection
checks to make the new approach pass; update their contracts and expected behavior deliberately.

Sample intermediate frames during warmed-up small zoom/pan animations as well as settled endpoints. Keep the checked
anchors inside the viewport and wait for initial data/tiles before starting; do not demand instantaneous rendering of
previously unloaded geography. A passing final-frame comparison alone must not conceal temporary icon disappearance
during the gesture.

Commands after implementation, from the repository root unless the component instructions say otherwise:

- `make verify PKG=packages/contracts`, `make verify PKG=data`, and `make verify PKG=apps/web` for affected owners.
- Confirm focused browser selections with `--list`, then run affected tests using the documented commands in
  [the frontend guide](../../apps/web/README.md#focused-browser-checks).
- `make check`, final full `make test-e2e` for both hosting projects, and `make verify PKG=docs`.
- `make dev DEV_FLAGS=-live-transport=false` for visual review, plus a fresh compliance reviewer before reporting done.
- Do not run `make build-data` for this place-metadata change. No Go changes are planned.

## Progress

- Completed: contracts, policy, producer command, place-only migration, level rendering, shared markers, chooser, search
  and selection exceptions, offline assets, tests, and docs. `places_facts_sha256` still equals the hash of the snapshot
  before levels were added, so no OSM fact or coordinate changed.
- Level tuning, used once: shops other than supermarkets, malls, and department stores moved from level 4 to level 5.
  Central Podgorica around `[19.24, 42.44]` at zoom 16 on desktop went from 248 icons with piles along shop rows to 84.
  Levels now hold 0, 50, 98, 850, and 813 places.
- Rendering decisions verified against vendored MapLibre 5.12.0: layer `minzoom`/`maxzoom` give exact results at
  fractional zooms, and `queryRenderedFeatures()` omits layers outside their zoom range.
- Known density limits, from screenshots at every threshold on phone and desktop:
  - Long shop rows still overlap at zoom 17, for example Bulevar knjaza Danila Petrovića 13. Each listing is reachable
    through the chooser.
  - House numbers draw over icons that share their position. The number stays readable and the icon's glyph is partly
    covered. Icons stay below road and address labels on purpose.
- Open decisions:
  - The default camera (zoom 15.8) is just below level 4 (zoom 16), so first view shows no cafes or restaurants.
  - Level 1 is empty and no overrides ship; both need editorial review.
  - Clinics and other unlisted essentials take that category's default, level 5.
- Rebased on PR #7, which owns search camera behavior and the phone card states. Opening search with no query or
  category has no leading result, so no icon gets a below-threshold exception. A chooser opens its phone card fully.
- A selected listing below its threshold that shares a location with an admitted listing is represented by that
  location's marker and highlight, not a second icon. The shipped snapshot has no co-located listings.
- The new tests pushed the single browser job past CI's 15-minute limit, so CI now runs browser tests as
  [separate jobs by area](../verification/testing.md#browser-test-areas). The threshold test also hides the basemap, and
  the density screenshots run on request (`POI_DENSITY_SCREENSHOTS=1`).
- Automated results, 4 November 2026: `make check` passes. The last full local browser run, before tests moved into area
  files, had 110 passed and 12 skipped; the move kept the same 122 test names. CI runs all areas on the final code.
- Not run: real-device review, `make dev` visual review (screenshots came from the browser suite), and
  `data/tools/extract-osm.py` with a real PBF (syntax-checked only).
