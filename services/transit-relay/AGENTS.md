# Transit backend

Read README.md and docs/transport.md from the repository root. The upstream feed is public but CORS-restricted to
ePodgorica; the public map needs a separately hosted relay.

Keep the upstream fixed, the API read-only, and refreshes bounded/cached. Never pass through caller-supplied URLs,
credentials, or headers. Do not invent vehicle identity or GPS age. Preserve stale/expiry behavior and coordinate
validation.

Run the Node relay tests and root make check. Hosted updates must sync canonical relay.mjs into the recorded Site
source; preserve its identity and audience. Never embed private service credentials in the web client.

<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->
<!-- agent-guideline: javascript sha256:d6598b82a7af -->

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
  tests in tests/integration; browser journeys in tests/e2e (Playwright).
- Add or update a test that fails without your change. Never delete, skip, or loosen an assertion to get green output.
- Verify: `make verify PKG=<component>`, then `make check`.

<!-- END GENERATED agent-guidelines -->
