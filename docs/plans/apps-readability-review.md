# Task: Apps readability review

Status: local verification complete; four-worker diagnostics documented; exact-package verification pending; drafts held

## Goal and acceptance criteria

- Review runtime, tools, unit tests and browser scenarios throughout `apps/` against the repository docs and
  `ivanov-gv/agents` guidelines.
- Split the public app by responsibility; use meaningful whole-word names, explicit units and booleans that read as
  facts. Expand the remaining dense tests and fixtures without weakening assertions.
- Preserve source identity, local assets, user-visible text, route behavior and verified offline copies.
- Keep PR #21 on `refactor/apps-readability-review` draft and unmerged. The owner explicitly prohibited merging or
  removing draft status until they say so, even though #20 has now merged.
- Review PR #22 separately without changing its branch or draft status.

## Decisions

No important architecture decision. The applications remain independent and consume the same published contracts.
Controllers use explicit getters for inputs that finish loading after event handlers are bound. No package, backend API
or new shared abstraction is introduced. HTML and CSS are byte-identical to current main, keeping whitespace and visual
source changes out of this refactor. The existing reduced-motion policy is preserved.

## Progress

- Rebased #21 onto #20 (`4913685`), preserving its focused-row restoration and phone-test tags.
- Extracted selection/camera/focus transactions, location controls, offline controls, card/result rendering, tap
  resolution, app-specific layers, status wording and DOM helpers. App startup now wires focused controllers and grouped
  state instead of 41 ungrouped module variables.
- Renamed search, distance, GeoJSON and scale helpers; position constants spell out milliseconds/metres. Fact-style
  flags replace bare state adjectives. The routing URL is assembled from named endpoint, coordinates, snapping radii and
  query values.
- Expanded dense unit/browser tests, including map-tap, worker and transport harnesses, routing fixtures and the
  two-release update server. Existing assertions, fixture data and timeouts remain intact.
- Preserved the offline fix: reopen the completed replacement before changing the activation marker. Its regression test
  fails without the ordering change.
- Preserved the update-test repair: drain the failed installation before publishing usable replacement assets.
- Registered every extracted runtime module in import boundaries, offline inventory and shared browser-area selection.
- Repository checks, manual visual inspection and independent compliance review pass. Exact-package verification
  remains; both drafts stay held for owner review.

## PR #22 review

Reviewed current head `6036592` against main `4913685` and prior head `35c8f39`, keeping pre-existing defects separate
from introduced changes.

- Retained defect: its offline activation marker changes before the completed file can be reopened. Running #21's five
  offline cases against #22 yields four passes and the activation-read-failure regression.
- Untested behavior change: live reduced-motion preferences can change subsequent animation duration during a session.
  That is outside a behavior-preserving refactor and has no transition test.
- Readability remains incomplete in routing fixtures, browser scenarios and some unit tests; some time variables and
  maximum/minimum names remain abbreviated.
- Retained race: the update fixture publishes usable replacement assets before all failed installation work settles.
- #20 integration is correct: focused-row restoration and its regression test are preserved in current #22.
- No additional introduced runtime regression was found in the inspected extracted callbacks, request-generation logic,
  import/offline inventories or CI registration. Its transit search matched the base in 1,000 deterministic cases.

The detailed review is reported to the owner; no external review comment or branch change was made to #22.

## Follow-up review

- Confirmed current #22 remains at `6036592`; a fresh read-only review confirms all five findings, with no additional
  substantive regression found. Its offline/update defects remain baseline defects; its focus integration is correct.
- Renamed `inBounds` to `isInBounds` and expanded the CI shared-source inventory to one entry per line.
- Named the route-camera duration and shared the reduced-motion query without changing when callers read it. The new
  framing test covers disabled/enabled/disabled preferences and preserves endpoint bounds and camera options.
- The reported building-selection failure did not reproduce: 12/12 four-worker repetitions passed, as did both
  deployment cases in the full four-worker run. This is not evidence that the reported flake is fixed.
- The full four-worker run before further fixture repairs gave 115 passed, 12 existing skips and 5 failures: a location
  fix aged to 52 seconds, a worker-notification race, two insufficient-frame-count failures (8/10 against >10), and the
  offline journey's unchanged 90-second timeout. No assertion or timeout was loosened.
- Refreshed the mock location before live-fix recentering, using changed accuracy to confirm delivery and adding an
  assertion that a fresh fix does not move the explored camera automatically. All 12 four-worker repetitions pass.
- Strengthened failed-update synchronization: observe `updatefound` and await that worker's `redundant` state; a
  temporarily null `installing` property can precede notification. Unexpected activation fails explicitly. All 12
  four-worker update repetitions pass. The fresh compliance review and bounded fixture recheck pass.
- Follow-up web verification passes all 74 unit tests, lint, build and offline inventory. The final full two-worker
  browser run passes 120 cases with 12 existing skips and no failures. This environment has a two-CPU quota; the full
  four-worker suite was not repeated after the fixture repairs. Remaining frame-count/timeout sensitivity is documented.

## Verification

Current web revision; editor/core-demo browser evidence is from unchanged `d0d8be1`:

- `make check` passes across the repository, including web 74 tests, editor 89 and core-demo 2. Documentation,
  import/dependency and agent-rule checks pass; all 70 CI-planner cases pass.
- Follow-up naming and motion-policy changes pass web verification, including the new route-framing transition test.
- Independent compliance review and its fixture recheck pass. No findings remain in the reviewed follow-up.
- Manual UI check through `make -C apps/web dev DEV_FLAGS=-live-transport=false PORT=9176`: inspected desktop 1280px,
  phone 412px and the 720/721px breakpoint. Search results, selected cards and map controls render correctly; category
  controls are 40px high, with no horizontal overflow or script errors. Screenshots and observations are retained as
  session artifacts. HTML/CSS are byte-identical to main.
- Final web browser suite: 120 passed, 12 existing device-specific skips, no failures (both deployment projects,
  Chromium/Vulkan, two workers).
- Final editor browser suite: 92 passed, 2 existing device-specific skips, no failures (both deployment projects,
  Chromium/Vulkan, two workers).
- Final core-demo browser suite: all 4 cases pass. Interrupted runs are not counted as full passes.

Dependency limitation: GitHub Packages rejects the environment's token (HTTP 401); direct npmjs queries returned 404 for
both pinned versions. Public review tools were installed separately from the lockfile. Local web/editor checks use the
checked-in core source as a supplemental substitute; core-demo intentionally uses it. No dependency manifest or lockfile
is changed. Exact web `0.1.1` and editor `0.1.0` package verification still needs the normal environment/CI.

## Handoff

Keep both #21 and #22 draft and unmerged until the owner's explicit instruction. Keep this plan while validation work is
unfinished, then delete it in the completing PR. Device location, GPU performance, storage eviction and physical LAN
installation remain outside automated evidence. Report full suites separately from targeted rechecks and retain the
exact-package limitation.
