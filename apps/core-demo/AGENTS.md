# Core concept app

Read [README.md](README.md), [JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md), and
[readability](../../docs/engineering/readability.md).

- Import only packages/map-core/src/index.js. No editor/web implementation, local helper modules, storage or product
  workflows. Keep one map and simple independent concept controls. Dev builds on main read repository data and shared
  formats at HEAD through tools/data-root.mjs and tools/contracts-root.mjs; no other file here may name a repository
  contracts path.
- tests/ reads data through tests/pinned-data.mjs and contracts through tests/pinned-contracts.mjs, using the exact
  `@ivanov-gv/map-data` and `@ivanov-gv/map-contracts` pins. Bump a pin only in its own change after a release; never
  point tests at repository data/ or packages/contracts/. Test targets set both roots. A future app production release
  pins every dependency (no production release exists yet).
- Use local assets and relative URLs; show async and map failures. Keep touch targets and visible keyboard focus.
- This project owns `eslint.config.mjs`: lint runs from here over source, tools, tests, journeys and app config files
  recursively. Current journeys live in `tests/e2e` and are covered by the test glob; `e2e/**/*.js` is also covered for
  the beside-src layout in JavaScript conventions. Runtime and tool helpers keep the 80-line function budget for both
  `.js` and `.mjs`; Node globals cover `.mjs` tools, tests and journeys. Only `*.test.js` paths take the documented
  long-test exception.
- This is an independent project: its Makefile, tests/e2e and ci-apps-core-demo pipeline are its own. Local
  `make verify PKG=apps/core-demo` and `make -C apps/core-demo e2e` are optional for iterating; the pre-push
  `make check` is required (builds and non-browser checks, no browser suites). GitHub's PR run gates the merge. Inspect
  desktop and phone previews through `make -C apps/core-demo dev` while iterating.
