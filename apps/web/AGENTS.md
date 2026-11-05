# Web application

Read [README.md](README.md), [architecture](../../docs/system-architecture/architecture.md), and
[contracts](../../packages/contracts/README.md).

- src/ owns runtime JavaScript; public/ owns HTML/CSS/icons/fonts/vendored bundles.
- tools/ assembles the app with published data into dist/web; do not commit generated output.
- tests/ owns component tests and tests/e2e browser acceptance; playwright.config.mjs owns browser projects and ports.
- Data inputs belong to data/, not this component. Consume its release and shared contracts.
- Keep core.js free of DOM/browser state. Preserve one map instance and local runtime assets.
- Keep archive/range responses outside shell caching and preserve verified downloads on failed replacements.
- Use relative paths so the built app works at / and /cg-map/.

## Testing

- The complete frontend CI verification job took **6m 38s**, including setup, repository checks, Chromium installation,
  browser acceptance, and artifact upload. Baseline reviewed 2026-11-03; browser tests alone took 5m 54s in CI and 5m
  40s locally (49 passed, one expected desktop touch skip). These are observations, not time limits. The suite has grown
  since; CI now runs it as [separate jobs by area](../../docs/verification/testing.md#browser-test-areas).
- Start with `make verify PKG=apps/web` from the repository root (about 3s locally). During iteration, run only affected
  browser scenarios using project, file, and title filters; confirm the selection with `--list`. See
  [focused browser commands](README.md#focused-browser-checks). npm test in this workspace builds before local web
  tests. Run `make verify` or `npm run verify` from apps/web for the same component checks.
- Run `make check` (about 13s locally) and full `make test-e2e` once after the final web/UI, offline, or release
  behavior change, covering both deployment projects. Install Chromium first with `npm run browser:install -- chromium`
  from apps/web if needed.
- Standalone browser commands build first. Use `make test-e2e-built` only after a successful web build (as CI does after
  building the artifact); the built-artifact variant never refreshes the artifact. Browser output stays in test-results/
  inside this component. Root npm/Make commands forward to the local implementations.
- Repeat passing suites only after relevant edits, failures, or an unresolved concern; do not rerun unchanged passing
  suites per turn. Documentation-only changes need Markdown, link/boundary, and agent-rule checks, not browser
  acceptance.
- Report exactly which checks ran; a targeted browser pass is not a full-suite pass. Do not weaken tests or timeouts to
  save time.
