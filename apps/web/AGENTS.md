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
  40s locally (49 passed, one expected desktop touch skip). These are observations, not time limits.
- Start with `make verify PKG=apps/web` from the repository root (about 3s locally). During iteration, run only affected
  browser scenarios using project, file, and title filters; confirm the selection with `--list`. See
  [focused browser commands](README.md#focused-browser-checks). npm test in this workspace builds before local web
  tests. Run `make verify` or `npm run verify` from apps/web for the same component checks.
- Run `make check` (about 13s locally) and full `make test-e2e` once after the final web/UI, offline, or release
  behavior change, covering both deployment projects. Install Chromium first with `npm run browser:install -- chromium`
  from apps/web if needed.
- Standalone browser commands build first. Use `make test-e2e-built` only after a successful web build (as CI does after
  `make check`); the built-artifact variant never refreshes the artifact. Browser output stays in test-results/ inside
  this component. Root npm/Make commands forward to the local implementations.
- Repeat passing suites only after relevant edits, failures, or an unresolved concern; do not rerun unchanged passing
  suites per turn. Documentation-only changes need Markdown, link/boundary, and agent-rule checks, not browser
  acceptance.
- Report exactly which checks ran; a targeted browser pass is not a full-suite pass. Do not weaken tests or timeouts to
  save time.

<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->
<!-- agent-guideline: javascript sha256:56d6d29c9c9d -->

## JavaScript conventions (from ../../docs/engineering/javascript.md)

Applies to every `*.js`/`*.mjs` file: browser runtime (apps/web/src), build tools, data pipeline scripts, platform
tooling, tests, and the transit relay. Enforced items name their check; fix the check's complaint instead of suppressing
it.

### Modules and runtime

- ES modules only (`"type": "module"`). Node tooling targets Node 24 and imports built-ins with the `node:` prefix.
- apps/web/src has no bundler or npm runtime imports. Import sibling modules by relative path with the `.js` extension.
  MapLibre and PMTiles are vendored globals (`maplibregl`, `pmtiles`). Enforced: ESLint `no-restricted-imports`.
- A new web module needs its allowed imports declared in platform/tools/check-repo.mjs; dynamic `import()` in web
  runtime is rejected. Enforced: `npm run check:repo`.
- core.js stays pure: no DOM, storage, network, or service-worker globals. Enforced: ESLint `no-restricted-globals`.
- data/tools never imports apps/web or services code; share formats through packages/contracts. Enforced: check-repo.

### Code

- Two-space indent, single quotes, semicolons, LF (.editorconfig). Match the density of the surrounding file; do not
  reformat code you are not changing.
- Prefix intentionally unused parameters with `_`. Enforced: ESLint `no-unused-vars`.
- Fail visibly. Network, storage, and archive failures must reach a user-visible state or a thrown error with context;
  never swallow errors silently.
- Validate external input (relay responses, routing APIs, OSM-derived data) at the boundary before use. Coordinates are
  WGS84 `[longitude, latitude]`.

### Dependencies

- Pin exact versions in package.json; install with `npm ci --ignore-scripts`. Do not add a dependency for something a
  few lines of standard library code can do.
- Browser runtime libraries and fonts are copied into the built artifact by apps/web/tools; never load them from a CDN.

### Tests

- Use `node:test` with `node:assert/strict`. Component tests live in `<component>/tests/*.test.mjs`; cross-component
  tests in tests/integration; browser journeys in apps/web/tests/e2e (Playwright).
- Add or update a test that fails without your change. Never delete, skip, or loosen an assertion to get green output.
- Verify: `make verify PKG=<component>`, then `make check`.

<!-- agent-guideline: ui sha256:dcc424bdb003 -->

## UI conventions (from ../../docs/engineering/ui.md)

Applies to apps/web/public (HTML, CSS, manifest, icons) and the DOM-facing modules in apps/web/src. Component boundaries
and offline invariants are in [apps/web/AGENTS.md](AGENTS.md); language rules are in
[javascript.md](../../docs/engineering/javascript.md).

### Layout and hosting

- The same artifact must work at `/` and `/cg-map/`. Use relative URLs for every asset, fetch, and service-worker scope.
  Enforced: Playwright `root-desktop` and `pages-mobile` projects.
- Phones are a primary target. Check the 720px breakpoint and a 412×840 touch viewport; keep touch targets at least
  40px.
- One MapLibre map instance per page. Add layers and sources to it rather than creating new maps.

### Styling

- Reuse the custom properties in style.css (`--green`, `--muted`, `--line`) and existing component classes before adding
  new colors or one-off styles.
- Keep visible keyboard focus (`:focus-visible`) and respect `prefers-reduced-motion`.
- Use `[hidden]` for show/hide; do not toggle inline `display` styles.

### Interaction and accessibility

- Use native elements: `<button>` for actions, `<a>` for navigation, form controls for input. Toggle buttons expose
  state with `aria-pressed`; icon-only controls need an accessible name.
- Loading, empty, stale, offline, and error states are part of the feature. Every async action needs a visible state for
  each.
- Show attribution and source notes required by [data licensing](../../docs/map-data/data-license.md) wherever the data
  is displayed.

### Verification

- `make test-e2e` for any user-visible change. Add a Playwright assertion for new interactions.
- Do a manual check through `make dev` for visual changes and report what was checked; e2e does not judge appearance.

<!-- agent-guideline: python sha256:d8f6352ddf72 -->

## Python conventions (from ../../docs/engineering/python.md)

Applies to `*.py`: data pipeline tools (data/tools), platform servers and packaging (platform/tools), the web
browser-test server (apps/web/tests/e2e), and their tests. Python 3.12.

### Python code

- New and substantially edited code follows PEP 8 with four-space indents, one import per line, and standard library
  imports first. Some legacy pipeline scripts use a compact style; do not reformat them as part of an unrelated change.
- Resolve repository paths from `Path(__file__).resolve().parents[n]`, never from the current working directory.
- Use `argparse` for command-line options and print a short summary of what was written.
- Exit non-zero with a clear message on invalid input; do not write partial outputs over reviewed sources.

### Geodata

- Coordinates are WGS84 `[longitude, latitude]`, rounded to 6 decimals where existing tools do. Polygon rings stay
  closed.
- Preserve provenance fields, attribution, and source identity. Do not invent stable IDs for legacy geometry (see
  [data/AGENTS.md](../../data/AGENTS.md)).
- Outputs must be reproducible: sort keys and features deterministically and avoid timestamps inside generated data
  unless provenance requires them.

### Python dependencies

- Platform tools and tests use the standard library only, so `make check` runs without a virtualenv.
- Geography tools may use the packages pinned in data/tools/requirements.txt. Add a dependency only by pinning it there.

### Tests and checks

- Tests use `unittest` and live in `<component>/tests/test_*.py`.
- Enforced: `python3 -m py_compile` on platform/tools, data/tools, and apps/web/tests/e2e, plus the platform unittest
  suite, in `make check`.
- Verify: `make verify PKG=<component>`, then `make check`. Geometry changes also need `make build-data`.

<!-- END GENERATED agent-guidelines -->
