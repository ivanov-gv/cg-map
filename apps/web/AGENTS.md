# Web application

Read [README.md](README.md), [architecture](../../docs/system-architecture/architecture.md), and
[contracts](../../packages/contracts/README.md).

- src/ owns runtime JavaScript; public/ owns HTML/CSS/icons. Fonts and vendored bundles come from packages/map-core.
- tools/ assembles the app with published data into dist/web; do not commit generated output.
- This project owns `eslint.config.mjs`: `npm run lint` runs ESLint from here over source, tools, tests and the config,
  then the runtime module guards. Its patterns and globals consume `platform/eslint-rules.mjs`;
  tests/lint-config.test.mjs proves them through the real config.
- tools/runtime-modules.mjs owns this app's runtime import, dynamic-import and MapLibre gesture checks, and supplies the
  module discovery shared by build.mjs and finalize.mjs. Per-folder rules in that file name which feature folders a
  module may import from and keep the published `@ivanov-gv/map-core` entry as the only external runtime package.
  Modules that existed on main keep their reviewed imports transitively, and every module with no local imports on main
  (for example `shared/core.js` and `shared/dom.js`) may not gain any. The build keeps each path and the offline shell
  is derived from the artifact. Colocated tests and support files never reach either.
- tests/ owns component tests and tests/e2e browser acceptance; playwright.config.mjs owns browser projects and ports.
- The browser suite is split into the shards counted in `browser-jobs.json`; `tools/browser-matrix.mjs` builds the CI
  matrix from that one number. Keep the number in web, never in platform tooling. Any web change runs all shards;
  [workflow testing](../../.github/TESTING.md#on-github) owns the smoke and full-run rule. Keep specs and per-file area
  lists out of the platform planner; prove a changed job count for the tagged phone tests with
  `E2E_WORKERS=2 npx playwright test --list --shard=i/N` for every shard, matching CI's worker count. Web runs only
  tagged phone tests, in PRs and nightly alike.
- Data inputs belong to data/, not this component. Plain non-release builds (`build`, `dev`, `dev-mock` and ci-publish
  image/Pages builds) take core, data and contracts from this commit through tools/core-root.mjs, tools/data-root.mjs
  and tools/contracts-root.mjs; no other file here may name a repository contracts path.
- Verification targets (`verify`, `test`, `test-built`, `offline-check`, `e2e`, `e2e-built`) set all three roots from
  the pins, so `make verify` builds the artifact CI uploads from the pinned packages. `make -C apps/web build-release`
  and `npm run release:prepare` also take the exact `@ivanov-gv/map-core`, `@ivanov-gv/map-data` and
  `@ivanov-gv/map-contracts` pins from package.json and refuse another root
  ([ADR 0046](../../docs/decisions/0046-editor-builds-take-their-own-core.md)). Platform's hosting test calls
  `build-pinned-core`: the caller supplies data and contracts pins, and Web supplies its own core pin without release
  enforcement. No production release has been published yet.
- tests/ reads core through tests/pinned-core.mjs, data through tests/pinned-data.mjs and contracts through
  tests/pinned-contracts.mjs, using the exact pins in package.json. Bump a pin only in its own change after a release;
  never point tests at repository data/ or packages/contracts/. Test targets set all three roots, so a package change
  cannot alter a test without a pin bump.
- Keep core.js free of DOM/browser state. Preserve one map instance and local runtime assets.
- Keep archive/range responses outside shell caching and preserve verified downloads on failed replacements.
- Use relative paths so the built app works at / and /cg-map/.
- Shared rendering lives in packages/map-core; keep its modules and assets in the offline inventory.

## Testing

- The complete frontend CI verification job took **6m 38s**, including setup, repository checks, Chromium installation,
  browser acceptance, and artifact upload. Baseline reviewed 2026-11-03; browser tests alone took 5m 54s in CI and 5m
  40s locally (49 passed, one expected desktop touch skip). These are observations, not time limits. The suite has grown
  since; CI now runs it as [separate shards](../../docs/verification/testing.md#browser-test-shards).
- For optional local iteration, start with `make verify PKG=apps/web` from the repository root (about 3s locally). Run
  only affected browser scenarios using project, file, and title filters; confirm the selection with `--list`. See
  [focused browser commands](README.md#focused-browser-checks). npm test in this workspace builds before local web
  tests. Run `make verify` or `npm run verify` from apps/web for the same component checks.
- Full `make -C apps/web e2e` is optional for iterating after a web/UI, offline, or release behavior change, covering
  both deployment projects; the pre-push hook runs the checks selected by the pushed diff (no browser suites,
  `make check` on failure). GitHub's PR run gates the merge. Install Chromium first with
  `npm run browser:install -- chromium` from apps/web if needed.
- Standalone browser commands build first. Use `make -C apps/web e2e-built` only after a successful web build (as CI
  does after building the artifact); the built-artifact variant never refreshes the artifact. Browser output stays in
  test-results/ inside this component.
- Repeat passing suites only after relevant edits, failures, or an unresolved concern; do not rerun unchanged passing
  suites per turn. Documentation-only changes need the docs pipeline on GitHub, not browser acceptance; local Markdown,
  link/boundary, and agent-rule checks are optional for iterating.
- Report exactly which checks ran; a targeted browser pass is not a full-suite pass. Do not weaken tests or timeouts to
  save time.
