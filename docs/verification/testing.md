# Testing

## Commands

```sh
make setup
make check
npx playwright install chromium
make test-e2e
make check-go
```

On Ubuntu 26.04, Playwright 1.56 has no Chromium build; install the 24.04 one with
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium` (see
[technical debt](../system-architecture/technical-debt.md)).

The pre-push hook's `make check` is required (builds and non-browser checks, no browser suites); the browser suites and
`act` runs shown here are optional for iterating, except `make test-cd-dev-pages` when changing ci-publish or
cd-dev-pages ([Pages recipe](../../.github/TESTING.md#pages-path-recipe)). A PR merges only when its `CI gate` passes on
GitHub: for a workflow change, the gate itself calls changed `ci-*` workflows in test-run mode and dispatches and waits
for changed `cd-*` workflows, as [the workflow rule](../../.github/TESTING.md) describes.

Frontend iteration commands and measured check durations live with the
[web application](../../apps/web/README.md#focused-browser-checks).

## Test ownership

| Location                                                       | Scope                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/map-core/src, packages/map-core/tools                 | Asset URLs, lifecycle and teardown, projection, hit testing, overlay selection, satellite, POI visibility, artifact assembly                          |
| apps/editor/tests                                              | Editing rules, session and history, gestures, changesets, drafts, source bundle integrity, overlay hit resolution, unknown property preservation      |
| apps/core-demo/src, apps/core-demo/tools, apps/core-demo/tests | Public-entry-only imports; pinned roots; dev target                                                                                                   |
| apps/web/tests                                                 | Pure helpers, offline transactions and module inventory, worker lifecycle, vendor contracts                                                           |
| data/tests                                                     | Place/geometry contracts and approved small fixture                                                                                                   |
| platform/tests                                                 | Actual Python HTTP/range behavior, LAN certificates and TLS, deployment compatibility                                                                 |
| services/transit-relay/tests                                   | Relay normalization, cache sharing, stale outage behavior, and read-only methods                                                                      |
| services/backend/cmd/server                                    | Go host directory/range behavior                                                                                                                      |
| tests/integration                                              | Real archive/MVT decoding, imagery hashes, shared categories, transport, editor changesets through the real importer, editor source bundle round trip |
| apps/web/tests/e2e                                             | Built web artifact, desktop/mobile, origin/project-prefix URLs, real offline download/reload                                                          |
| apps/editor/tests/e2e                                          | Built source editor: every edit through the real map, including touch; offline install and updates, desktop/mobile, origin/project-prefix URLs        |
| apps/core-demo/e2e                                             | Built concept app and each map-core capability, desktop/mobile, origin/project-prefix URLs                                                            |

make check runs `verify` in every project, which together build dist/web, dist/core-demo and dist/editor and run
Node/Python tests, JavaScript lint, all-source Markdown structure/format checks, data/provenance/release checks,
docs/layout/dependency checks, and generated manifest verification. `make check-go` independently runs Go vet,
golangci-lint, tests, and build. See
[Markdown checks and formatting](../runbooks/development.md#markdown-checks-and-formatting) for the shared rules and fix
command.

When adding a browser test, follow [the testing guideline](../engineering/testing.md). Each browser project runs
Playwright against its own built artifact. For the deployable web artifact, it tests / and /cg-map/, fixture-backed
search/selection, satellite switching with one map instance, and downloading/reloading the reviewed archive offline.
Discover checks cover the street-scale first view and key, granted/denied location states, country-scale POI
suppression, and named layer failures; geolocation is emulated, so physical-device fixes remain a manual check.
Compatibility tests preserve old /web/ entry behavior. On failure, traces/screenshots are uploaded by CI.

These checks do not prove GIS topology, real-world listing freshness, phone GPU performance, or persistent storage
retention. Test the target phone for gestures, rotation/folding, interrupted/full-storage downloads, airplane-mode
reopening, eviction, and long-running memory/frame behavior.

The detailed earlier design guide includes historical verification evidence. Current commands, ownership, and CI are
authoritative for this layout.

## What runs in CI

[ci-pr-checks](../../.github/workflows/ci-pr-checks.yml) calls one workflow per project, chosen from the diff by
[the planner](../../platform/tools/ci-plan.mjs), and reports one `CI gate`. Anything the planner cannot classify runs
everything. The same gate calls each changed `ci-*` workflow in test-run mode and asks `ci-workflows` to dispatch and
wait for each changed `cd-*` workflow, so a workflow change is proved by real GitHub runs, not by a re-runnable evidence
check. [ci-publish](../../.github/workflows/ci-publish.yml) runs independently on every push to main with its own
test-run switch and planner (shared with ci-pr-checks through a composite action), building and pushing images and
packages — it runs no tests as the PR run already tested the content. The `pages` job in ci-publish builds the dev site
from source and pushes the image. [cd-dev-pages](../../.github/workflows/cd-dev-pages.yml) pulls that image and deploys
it to GitHub Pages. [ci-nightly](../../.github/workflows/ci-nightly.yml) runs every night by calling ci-pr-checks with
`run_all: true`.

| Changed                                                     | Runs                                                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown, except under `apps/*/public`                      | `docs` only: no code checks                                                                                                                                                 |
| Backend Go code                                             | `backend` only                                                                                                                                                              |
| `services/transit-relay`                                    | `transit-relay`                                                                                                                                                             |
| `platform/pages`                                            | `platform`, `apps-web`, every browser area                                                                                                                                  |
| `platform/tools/serve.py`, `dev-port.mjs`                   | `platform` and every map application, whose workflows run their own browser suites                                                                                          |
| `platform/browser-image`                                    | `browser-image`, `platform`                                                                                                                                                 |
| `platform/tools/lan_certificate.py`                         | `platform`, `apps-editor`                                                                                                                                                   |
| `platform/tools/phone-tags.mjs`                             | `platform`, `apps-web`, `apps-editor`                                                                                                                                       |
| `tests`, `data/tools`, `data/tests`, the rest of `platform` | That folder, except as listed below                                                                                                                                         |
| `apps/web`                                                  | `apps-web`, `tests`, `platform`, and the whole web browser suite                                                                                                            |
| `apps/editor`                                               | `apps-editor`, `tests`, and the whole editor browser suite                                                                                                                  |
| `apps/core-demo`                                            | `apps-core-demo`                                                                                                                                                            |
| `packages/map-core`                                         | `map-core`, every map application, `tests`, `platform`, every browser area                                                                                                  |
| `data/tools/editor-bundle.mjs`                              | `data`, `apps-editor`, `tests`                                                                                                                                              |
| `data/tools` changeset importer, data check, level policy   | `data`, `tests`                                                                                                                                                             |
| `data/tests/fixtures`                                       | `data`, `apps-web`, `tests`, `platform`, every browser area                                                                                                                 |
| `data/sources`, `artifacts`, `imagery`                      | `data`, every map application, `tests`, `platform`, every browser area                                                                                                      |
| `packages/contracts`                                        | `contracts`, `data`, `tests`, `platform`                                                                                                                                    |
| `.github`, the planner                                      | `workflows`, `platform`, plus test runs: see [.github/TESTING.md](../../.github/TESTING.md)                                                                                 |
| Root `Makefile`                                             | Only the folders whose CI calls it: `docs`, `workflows`, `platform`, `contracts`, `data`, `transit-relay`, `tests`, `map-core`, `apps-web`, `apps-editor`, `apps-core-demo` |
| `package-lock.json`                                         | The projects whose workspace entries changed, plus `platform` for its pin checks; hoisted, unmapped or unreadable entries run everything                                    |
| Other root files such as `package.json`, or unknown paths   | Everything                                                                                                                                                                  |

The root Makefile rule follows its CI callers: `make verify PKG=<path>` in the folder workflows and `make check-docs` in
ci-docs, plus the `workflows` folder for its lint-workflows and act targets. Browser jobs, the backend and the browser
image use their own project Makefiles; the planner emits no browser matrix. It reads `package-lock.json` at base and
head: changed workspace entries select their own projects, plus `platform` because its pin checks read the lockfile;
shared or unreadable entries run everything.

Check a branch with `make ci-plan BASE=origin/main`.

## Phone layout tests

A PR runs web and editor tests on the phone layout only when they are tagged `@phone`. In apps/web every run does the
same — nightly, CI test runs and a plain `make e2e` — so a test that misses the tag never runs on the phone. The
`phone_tests` CI input applies only to apps/editor, whose nightly still runs every test on the phone. The desktop
project runs everything except tests scoped to another project. List the web phone selection with
`npx playwright test --list --project=pages-mobile`.

In apps/web, a test that works on one layout only declares that in its tags instead of skipping itself after setup and
page load. `@desktop` runs in `root-desktop` only; `@phone-only` (always with `@phone`) runs in `pages-mobile` only;
`@mobile-only` (with `@phone`) also keeps a phone-layout scenario out of `root-desktop`. `grepInvert` in
`playwright.config.mjs` filters the unwanted project before the test starts. Use both `@mobile-only` and `@phone` when a
scenario needs the phone project's layout and would otherwise be repeated on desktop. This replaces a loop over
desktop/mobile/Flip viewports inside a spec: use the project's viewport and add a separate case only where the code
takes a different path. List the scoped cases with
`npx playwright test --list --project=pages-mobile --grep '@mobile-only'`.

Tag a test `@phone` when it:

- only runs on the phone layout, or behaves differently there, branching on `isMobile`, `hasTouch`, touch input or the
  viewport width, in its own body, a helper it calls, or the skips and hooks of its describe: a check in each app's
  tests fails if such a test has no tag. Both checks use [phone-tags](../../platform/tools/phone-tags.mjs); each app's
  own test imports that shared tool, and the app test owns its neutral helpers, such as `closeCard`;
- needs the `/cg-map/` prefix, which only the phone project uses;
- is the one whole journey for its app, or its one check of layout overflow.

The editor's install test is also tagged. The web app has no install test to tag.

## Browser test shards

CI builds once, then runs browser tests as separate jobs with their own time limit. Pushes to main run no tests;
[ADR 0006](../decisions/0006-ci-time-limits-and-tests-before-merge.md) records that decision, and
[ADR 0032](../decisions/0032-tests-pass-on-github-and-earn-their-cost.md) changes the merge rule to GitHub runs.

Each app owns its browser suite and the shard count in its own `browser-jobs.json`:
[web](../../apps/web/browser-jobs.json) and [editor](../../apps/editor/browser-jobs.json). A change to an app runs every
shard in that app; Playwright discovers the tests, so a new spec needs no platform change. The app instructions hold the
proof rules for a changed count: [web](../../apps/web/AGENTS.md) and [editor](../../apps/editor/AGENTS.md).
[Workflow testing](../../.github/TESTING.md#on-github) says when CI uses the full count or a one-shard smoke proof, and
[ADR 0041](../decisions/0041-app-owned-browser-shards.md) records why the apps own the split.

## Monorepo verification — 2026-10-18

Executed locally: 35 Node tests, five Python tests, six Playwright tests, lint, source/release/contract validation,
documentation/boundary checks, offline manifests, and both workspace-local test commands. The full geography pipeline
was not rerun: source geometry and archive bytes were moved unchanged. Backend Go checks and the actual Pages deployment
are verified by their GitHub workflows.

Transport feature verification: relay/cache/stale lifecycle unit tests, client late-response/expiry tests,
desktop/mobile toggling and failure/offline acceptance. The public hosted relay returned actual upstream positions with
anonymous access and public read CORS. Browser acceptance uses deterministic responses; live integration is smoke-tested
separately.

Route planning: provider tests block service workers so the offline shell cannot substitute the real network for
deterministic fixtures. Car/foot profiles, validation, cached/cancelled requests, direct and one-transfer bus search,
mode switching, missing routes, identical points and clearing are covered. The separate offline acceptance test uses the
actual bundled bus network and cached map. Live provider smoke tests are separate from mocked browser acceptance.
