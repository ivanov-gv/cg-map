# Web application

Read [README.md](README.md), [architecture](../../ARCHITECTURE.md), and [contracts](../../packages/contracts/README.md).

- src/ owns runtime JavaScript; public/ owns HTML/CSS/icons/fonts/vendored bundles.
- tools/ assembles the app with published data into dist/web; do not commit generated output.
- Data inputs belong to data/, not this component. Consume its release and shared contracts.
- Keep core.js free of DOM/browser state. Preserve one map instance and local runtime assets.
- Keep archive/range responses outside shell caching and preserve verified downloads on failed replacements.
- Use relative paths so the built app works at / and /cg-map/.
- From the root, run make check and make test-e2e after web/offline changes. npm test in this workspace builds the artifact before local web tests.

<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->
<!-- agent-guideline: javascript sha256:5cc81b0883d1 -->
## JavaScript conventions (from ../../docs/engineering/javascript.md)

Applies to every `*.js`/`*.mjs` file: browser runtime (apps/web/src), build tools, data pipeline scripts, platform tooling, tests, and the transit relay. Enforced items name their check; fix the check's complaint instead of suppressing it.

### Modules and runtime

- ES modules only (`"type": "module"`). Node tooling targets Node 24 and imports built-ins with the `node:` prefix.
- apps/web/src has no bundler or npm runtime imports. Import sibling modules by relative path with the `.js` extension. MapLibre and PMTiles are vendored globals (`maplibregl`, `pmtiles`). Enforced: ESLint `no-restricted-imports`.
- A new web module needs its allowed imports declared in platform/tools/check-repo.mjs; dynamic `import()` in web runtime is rejected. Enforced: `npm run check:repo`.
- core.js stays pure: no DOM, storage, network, or service-worker globals. Enforced: ESLint `no-restricted-globals`.
- data/tools never imports apps/web or services code; share formats through packages/contracts. Enforced: check-repo.

### Code

- Two-space indent, single quotes, semicolons, LF (.editorconfig). Match the density of the surrounding file; do not reformat code you are not changing.
- Prefix intentionally unused parameters with `_`. Enforced: ESLint `no-unused-vars`.
- Fail visibly. Network, storage, and archive failures must reach a user-visible state or a thrown error with context; never swallow errors silently.
- Validate external input (relay responses, routing APIs, OSM-derived data) at the boundary before use. Coordinates are WGS84 `[longitude, latitude]`.

### Dependencies

- Pin exact versions in package.json; install with `npm ci --ignore-scripts`. Do not add a dependency for something a few lines of standard library code can do.
- Browser runtime libraries and fonts are copied into the built artifact by apps/web/tools; never load them from a CDN.

### Tests

- Use `node:test` with `node:assert/strict`. Component tests live in `<component>/tests/*.test.mjs`; cross-component tests in tests/integration; browser journeys in tests/e2e (Playwright).
- Add or update a test that fails without your change. Never delete, skip, or loosen an assertion to get green output.
- Verify: `make verify PKG=<component>`, then `make check`.

<!-- agent-guideline: ui sha256:0faeaf4a8275 -->
## UI conventions (from ../../docs/engineering/ui.md)

Applies to apps/web/public (HTML, CSS, manifest, icons) and the DOM-facing modules in apps/web/src. Component boundaries and offline invariants are in [apps/web/AGENTS.md](AGENTS.md); language rules are in [javascript.md](../../docs/engineering/javascript.md).

### Layout and hosting

- The same artifact must work at `/` and `/cg-map/`. Use relative URLs for every asset, fetch, and service-worker scope. Enforced: Playwright `root-desktop` and `pages-mobile` projects.
- Phones are a primary target. Check the 720px breakpoint and a 412×840 touch viewport; keep touch targets at least 40px.
- One MapLibre map instance per page. Add layers and sources to it rather than creating new maps.

### Styling

- Reuse the custom properties in style.css (`--green`, `--muted`, `--line`) and existing component classes before adding new colors or one-off styles.
- Keep visible keyboard focus (`:focus-visible`) and respect `prefers-reduced-motion`.
- Use `[hidden]` for show/hide; do not toggle inline `display` styles.

### Interaction and accessibility

- Use native elements: `<button>` for actions, `<a>` for navigation, form controls for input. Toggle buttons expose state with `aria-pressed`; icon-only controls need an accessible name.
- Loading, empty, stale, offline, and error states are part of the feature. Every async action needs a visible state for each.
- Show attribution and source notes required by [DATA_LICENSE.md](../../DATA_LICENSE.md) wherever the data is displayed.

### Verification

- `make test-e2e` for any user-visible change. Add a Playwright assertion for new interactions.
- Do a manual check through `make dev` for visual changes and report what was checked; e2e does not judge appearance.

<!-- END GENERATED agent-guidelines -->
