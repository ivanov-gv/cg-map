# Task: Apps readability review

Status: blocked on pinned-package verification and PR #20

## Goal and acceptance criteria

- Review all three apps against their docs and the `ivanov-gv/agents` guidelines.
- Make dense control flow readable, name domain values, and separate complex steps while preserving shared contracts.
- Preserve source identity, local assets, route behavior, verified offline copies, and every existing test assertion.
- Work on `refactor/apps-readability-review`; do not merge before PR #20 merges.

## Decisions

Keep each app independent. Keep orchestration in its app and domain steps in their existing modules. No new dependency,
shared abstraction, or consequential architecture decision is introduced.

## Review findings and scope

The review covered the 114 existing tracked files under `apps/`: application modules, build tools, HTML/CSS and asset
references, manifests, package and hosting configuration, component tests, browser suites, and the editor prototype. The
prototype remains an explicitly documented schematic outside the deployed artifact.

| Area                     | Finding and outcome                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public app orchestration | Expanded compressed statements, named places and lookup state, and separated control registration and place-detail rendering. The single-map lifecycle and camera/focus behavior stay intact.                                                                                                                                                          |
| Route planning           | Split access, boarding, transfer and destination search; named search limits and penalties. Separated transit loading, walking refinement, notes, geometry and camera framing. Cancellation generations and displayed waiting-time caveats remain intact.                                                                                              |
| Offline storage          | Split shell saving, staged streaming, verification and copying. Fixed activation occurring before reopening the completed replacement: a read failure now preserves the previous marker and map. A regression test reproduced the failure before the fix.                                                                                              |
| Boundary validation      | Named transport collection, freshness, coordinate, coverage and direction predicates, and road metrics/geometry predicates. Named time units and limits; retained existing rejection behavior.                                                                                                                                                         |
| Public assets and tools  | Expanded HTML/CSS and compressed build/manifest code. Kept selectors, asset paths, shell inventory, data provenance, and wire formats intact.                                                                                                                                                                                                          |
| Editor                   | Reviewed source verification, active-file commands, edit transactions, geometry/property validation, drafts, changesets, offline installation and updates. Its existing focused modules remain appropriate; no runtime rewrite was needed.                                                                                                             |
| Core demo                | Reviewed its independent build and lifecycle, overlay/projection/selection controls, error recovery and desktop/mobile tests. Its intentionally small public-core consumer remains appropriate.                                                                                                                                                        |
| Tests                    | Preserved existing assertions; added activation-read-failure coverage and focused route tests for mode state, late transit responses, approximate foot-link fallback and cancellation. A pre-existing update fixture race was reproduced on unchanged main and fixed by waiting for the failed installation before publishing the next usable release. |

## Progress

- Completed: review, refactor, regression coverage, updated web walkthrough, and independent compliance review.
- Compliance review: two major and two minor findings fixed. Both re-checks passed with no findings, including the final
  fixture synchronization change.
- Remaining: verify web/editor against their exact published core packages; the full editor browser suite was not
  completed.
- External dependency: PR #20 remains open. Do not enable auto-merge while it is open.

## Verification

- `make check` passed, including all nine component gates and cross-component integration checks.
- `make verify PKG=apps/web` passed: 70 tests, lint, build and offline inventory checks.
- `make verify PKG=apps/editor` passed: 89 tests, lint and build.
- `make verify PKG=apps/core-demo` passed: 2 tests, lint and build.
- `make -C apps/core-demo e2e`: all 4 desktop/mobile tests passed.
- `make check-go` passed with the pinned Go 1.26.8 toolchain: vet, lint (0 issues), race tests and build.
- Full web browser run with Vulkan/two workers: 115 passed, 12 existing device-specific skips, 1 failed in the update
  fixture. The same failure reproduced once in three runs on unchanged main (2 passed, 1 failed).
- After synchronizing the fixture's failed installation, `make -C apps/web e2e-built` with
  `E2E_ARGS='tests/e2e/updates.spec.mjs --repeat-each=5'` passed all 10 root/prefixed-URL repetitions. The entire suite
  was not repeated after this test-only repair.
- Focused editor rechecks with Vulkan/one worker: all 6 desktop/mobile cases passed (POI export/import, invalid details,
  tampered source rejection). This is not a full editor browser-suite pass.
- Earlier simultaneous SwiftShader browser runs competed for this environment's two-CPU quota. The web location case
  failed after its fix became stale; its isolated Vulkan recheck passed. The unchanged editor had two startup assertion
  timeouts; that run was stopped after 4 passes, 2 failures and 2 interrupted tests. Remaining cases were not run.

Dependency limitation: `make setup` fails with HTTP 401 downloading the public `@ivanov-gv/map-core` packages from
GitHub Packages. Direct npm public-registry queries return 404 for both pinned versions. Public review tools were
installed from the lockfile in a temporary directory; web/editor checks above used the checked-in core source as a
supplemental substitute. Core-demo is designed to use that source. No dependency manifest or lockfile was changed. A
passing substitute check does not establish compatibility with web's `0.1.1` or editor's `0.1.0` package.

## Handoff

Branch: `refactor/apps-readability-review`. Keep the PR unmerged until #20 merges and exact-package verification
succeeds. Keep this plan while those checks are unfinished, then delete it in the completing PR. Device GPU performance,
physical-device location, storage eviction and LAN installation remain outside this review's automated evidence.
