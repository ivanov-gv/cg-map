# Platform and release tooling

Read [README.md](README.md) and [release runbook](../docs/runbooks/release.md). Publish only dist/web; never upload the repository or source datasets as Pages content. Keep deployment write permissions in the deploy job. Do not clear origin-wide caches or OPFS in compatibility migrations.

<!-- BEGIN GENERATED agent-guidelines: edit docs/engineering/*.md and run `make agent-rules` -->
<!-- agent-guideline: javascript sha256:5cc81b0883d1 -->
## JavaScript conventions (from ../docs/engineering/javascript.md)

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

<!-- agent-guideline: python sha256:989216fe48b6 -->
## Python conventions (from ../docs/engineering/python.md)

Applies to `*.py`: data pipeline tools (data/tools), platform servers and packaging (platform/tools), and their tests. Python 3.12.

### Code

- New and substantially edited code follows PEP 8 with four-space indents, one import per line, and standard library imports first. Some legacy pipeline scripts use a compact style; do not reformat them as part of an unrelated change.
- Resolve repository paths from `Path(__file__).resolve().parents[n]`, never from the current working directory.
- Use `argparse` for command-line options and print a short summary of what was written.
- Exit non-zero with a clear message on invalid input; do not write partial outputs over reviewed sources.

### Geodata

- Coordinates are WGS84 `[longitude, latitude]`, rounded to 6 decimals where existing tools do. Polygon rings stay closed.
- Preserve provenance fields, attribution, and source identity. Do not invent stable IDs for legacy geometry (see [data/AGENTS.md](../data/AGENTS.md)).
- Outputs must be reproducible: sort keys and features deterministically and avoid timestamps inside generated data unless provenance requires them.

### Dependencies

- Platform tools and tests use the standard library only, so `make check` runs without a virtualenv.
- Geography tools may use the packages pinned in data/tools/requirements.txt. Add a dependency only by pinning it there.

### Tests and checks

- Tests use `unittest` and live in `<component>/tests/test_*.py`.
- Enforced: `python3 -m py_compile` on platform/tools and data/tools, and the platform unittest suite, both in `make check`.
- Verify: `make verify PKG=<component>`, then `make check`. Geometry changes also need `make build-data`.

<!-- END GENERATED agent-guidelines -->
