# Core concept app

Read [README.md](README.md), [JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md), and
[readability](../../docs/engineering/readability.md).

- Import only packages/map-core/src/index.js. No editor/web implementation, local helper modules, storage or product
  workflows. Keep one map and simple independent concept controls. Plain non-release builds (`build`, `dev` and the
  ci-publish image/Pages builds) take core, data and shared formats from this commit through tools/core-root.mjs,
  tools/data-root.mjs and tools/contracts-root.mjs; no other file here may name a repository contracts path.
- Verification targets (`verify`, `test`, `e2e`, `e2e-built`) and `make -C apps/core-demo build-release` take core, data
  and contracts from the exact pins in package.json and refuse another root
  ([ADR 0046](../../docs/decisions/0046-editor-builds-take-their-own-core.md)). This app pins the workspace `0.0.0-dev`
  core because it is core's dev environment, so its tests and release build follow core HEAD until a core release
  exists. No production app release exists yet; `build-release` is a local release-candidate command.
- tests/pinned-core.mjs, tests/pinned-data.mjs and tests/pinned-contracts.mjs read those pins. Their paths stay in
  tests/ because platform's pin checks name that folder; the other unit tests sit next to their src/ and tools/ code.
  tests/lint-config.test.mjs also stays there because it checks the app-owned lint config. Bump a pin only in its own
  change after a release; never point tests at repository data/ or packages/contracts/. Test targets set all three
  roots.
- Browser journeys are e2e/*.spec.js beside src. Build artifacts carry neither tests nor the pinned helpers.
- Use local assets and relative URLs; show async and map failures. Keep touch targets and visible keyboard focus.
- This project owns `eslint.config.mjs`: lint runs from here over source, tools, tests, journeys and app config files
  recursively. Current journeys live in `e2e` beside src and are covered by that recursive glob. Runtime and tool
  helpers keep the 80-line function budget for both `.js` and `.mjs`; Node globals cover `.mjs` tools, tests and
  journeys. Only `*.test.js` paths take the documented long-test exception.
- This is an independent project: its Makefile, e2e and ci-apps-core-demo pipeline are its own. Local
  `make verify PKG=apps/core-demo` and `make -C apps/core-demo e2e` are optional for iterating; the pre-push hook runs
  the checks selected by the pushed diff (no browser suites, `make check` on failure). GitHub's PR run gates the merge.
  Inspect desktop and phone previews through `make -C apps/core-demo dev` while iterating.
