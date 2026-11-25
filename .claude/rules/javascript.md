---
description: JavaScript conventions (generated from docs/engineering/javascript.md)
paths:
  - "**/*.js"
  - "**/*.mjs"
  - "**/package.json"
---

<!-- GENERATED from docs/engineering/javascript.md
by platform/agents/gen-agent-rules.mjs. Do not edit; run `make agent-rules`. -->

# JavaScript conventions

Applies to every `*.js`/`*.mjs` file: browser runtime (apps/web/src), build tools, data pipeline scripts, platform
tooling, tests, and the transit relay. Enforced items name their check; fix the check's complaint instead of suppressing
it.

## Modules and runtime

- ES modules only (`"type": "module"`). Node tooling targets Node 24 and imports built-ins with the `node:` prefix.
- apps/web/src has no bundler or npm runtime imports. Import sibling modules by relative path with the `.js` extension,
  and shared map code only through the packages/map-core entry; builds relocate that import into each artifact. MapLibre
  and PMTiles are vendored globals (`maplibregl`, `pmtiles`). Enforced: ESLint `no-restricted-imports`.
- A new web module needs its allowed imports declared in platform/tools/check-repo.mjs, its file in the offline shell
  list in apps/web/tools/finalize.mjs, and a browser area or shared-source entry in platform/tools/ci-plan.mjs. Dynamic
  `import()` in web runtime is rejected. Enforced: `npm run check:repo`, the offline inventory test, and ci-plan tests.
- core.js stays pure: no DOM, storage, network, or service-worker globals. Enforced: ESLint `no-restricted-globals`.
- data/tools never imports apps/web or services code; share formats through packages/contracts. Enforced: check-repo.

## Code

- Two-space indent, single quotes, semicolons, LF (.editorconfig). Do not reformat code you are not changing.
- Prefix intentionally unused parameters with `_`. Enforced: ESLint `no-unused-vars`.
- Fail visibly. Network, storage, and archive failures must reach a user-visible state or a thrown error with context;
  never swallow errors silently.
- Validate external input (relay responses, routing APIs, OSM-derived data) at the boundary before use. Coordinates are
  WGS84 `[longitude, latitude]`.

## Dependencies

- Pin exact versions in package.json; install with `npm ci --ignore-scripts`. Do not add a dependency for something a
  few lines of standard library code can do.
- Browser runtime libraries and fonts are committed in packages/map-core/assets and copied into each built artifact by
  its build tool; never load them from a CDN.

## Tests

- Use `node:test` with `node:assert/strict`. In an app or packages/map-core a test lies next to the code it tests, in
  folders by feature, and its name says what it needs:
  - `roads/roads.js`: the component;
  - `roads/roads.test.js`: its unit tests, without a browser;
  - `roads/roads.browser.test.js`: only what needs a real browser. It starts the component, not the whole app;
  - `e2e/roads.spec.js`, beside `src`: a user's job from start to end (Playwright).
- Builds and published packages leave tests out. apps/web, apps/editor, apps/core-demo and packages/map-core still have
  tests in `tests/`: they move project by project, and until then new tests stay beside the ones that are there.
- Pipeline, platform and service tests live in `<component>/tests/*.test.mjs`; cross-component tests in
  tests/integration.
- Add or update a test that fails without your change. Never delete, skip, or loosen an assertion to get green output.
- A browser test waits for a state: an event, or a poll on a condition. A fixed delay is not synchronization. A failure
  seen only with parallel workers is not a flake to dismiss: investigate both races and resource limits (frame rate,
  time budgets), record the worker count and machine capacity, and keep its assertions.
- `make verify PKG=<component>` and browser suites are optional for iterating; the pre-push hook's `make check` is
  required (builds and non-browser checks, no browser suites). A PR merges only when its tests pass on GitHub
  ([the rule](.github/TESTING.md)).
