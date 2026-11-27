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
- Modules that existed on main keep their reviewed imports transitively: a new module may not widen which main modules
  they reach, and every module with no local imports on main (for example `core.js` and `dom.js`) may not gain any.
  Moving a reviewed module fails until its rule moves into #456's per-folder rules. New modules may import any runtime
  module inside apps/web/src and the published map-core entry. Dynamic `import()` and MapLibre gesture handlers are
  rejected. The build discovers modules at every depth, preserves their paths and derives the offline shell from the
  built artifact ([ADR 0045](docs/decisions/0045-build-derived-web-shell.md)); colocated tests, support files,
  config.json, generated manifests and archive/range responses stay out. Playwright discovers browser tests, so no
  planner entry is needed. Web owns these source checks in apps/web/tools/runtime-modules.mjs and its component tests. A
  web change still selects platform: build-web and hosting tests, package pins, Makefiles and dev-site tests read web
  files until issue #456 moves those checks. Enforced: `npm run lint` in apps/web and its component tests.
  `npm run check:repo` and platform's verify still cover repository layout, data roots and other component boundaries.
- core.js stays pure: no DOM, storage, network, or service-worker globals. Enforced: ESLint `no-restricted-globals`.
- data/tools never imports apps/web or services code; share formats through packages/contracts. Enforced: check-repo.

## Lint configuration

Every project that lints owns `eslint.config.mjs` beside its Makefile or package.json and chooses its own file patterns
and globals; ESLint finds it from the folder the lint command runs in. Their rule sets live in
[platform/eslint-rules.mjs](platform/eslint-rules.mjs), which names no project file. Enforced: `npm run check:repo`,
which also rejects a new root-level config. The pre-commit hook lints each staged file from its owning project;
[ci-plan](platform/tools/ci-plan.mjs)'s tests cover pipeline selection. All nine linting projects consume the shared
rules, including apps/web; the root config is retired and a change to that path selects only platform tooling. Each
app's lint-config test checks its own patterns and rules. See
[ADR 0043](docs/decisions/0043-project-owned-eslint-configurations.md) and the consumer list in
[architecture](docs/system-architecture/architecture.md#independent-projects).

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

- Use `node:test` with `node:assert/strict`. In an app or packages/map-core a test lies next to the code it tests, and
  its name says what it needs ([why](docs/decisions/0040-tests-next-to-their-code.md)). apps/web and apps/editor sort
  their sources into folders by feature. Example:
  - `roads/roads.js`: the component;
  - `roads/roads.test.js`: its unit tests, without a browser;
  - `roads/roads.browser.test.js`: only what needs a real browser (Playwright). It starts the component, not the whole
    app, and globs for unit tests leave it out;
  - `e2e/roads.spec.js`, beside `src`: a user's job from start to end (Playwright).
- A project that moves its tests leaves them out of its build or published package. Until a component has moved, its new
  tests go into `tests/` as `*.test.mjs` or `*.spec.mjs`.
- Contracts, data, platform and service tests live in `<component>/tests/*.test.mjs`; cross-component tests in
  tests/integration.
- Add or update a test that fails without your change. Never delete, skip, or loosen an assertion to get green output.
- A browser test waits for a state: an event, or a poll on a condition. A fixed delay is not synchronization. A failure
  seen only with parallel workers is not a flake to dismiss: investigate both races and resource limits (frame rate,
  time budgets), record the worker count and machine capacity, and keep its assertions.
- `make verify PKG=<component>` and browser suites are optional for iterating; the pre-push hook's `make check` is
  required (builds and non-browser checks, no browser suites). A PR merges only when its tests pass on GitHub
  ([the rule](.github/TESTING.md)).
