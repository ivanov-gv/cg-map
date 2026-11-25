# Core concept app

Read [README.md](README.md), [JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md), and
[readability](../../docs/engineering/readability.md).

- Import only packages/map-core/src/index.js. No editor/web implementation, local helper modules, storage or product
  workflows. Keep one map and simple independent concept controls. Dev builds on main read repository data and shared
  formats at HEAD through tools/data-root.mjs and tools/contracts-root.mjs; no other file here may name a repository
  contracts path.
- tests/pinned-data.mjs and tests/pinned-contracts.mjs read the exact `@ivanov-gv/map-data` and
  `@ivanov-gv/map-contracts` pins. Their paths stay in tests/ because platform's pin checks name that folder; the other
  unit tests sit next to their src/ and tools/ code. Bump a pin only in its own change after a release; never point
  tests at repository data/ or packages/contracts/. Test targets set both roots. A future app production release pins
  every dependency (no production release exists yet).
- Browser journeys are e2e/*.spec.js beside src. Build artifacts carry neither tests nor the pinned helpers.
- Use local assets and relative URLs; show async and map failures. Keep touch targets and visible keyboard focus.
- This is an independent project: its Makefile, e2e and ci-apps-core-demo pipeline are its own. Local
  `make verify PKG=apps/core-demo` and `make -C apps/core-demo e2e` are optional for iterating; the pre-push
  `make check` is required (builds and non-browser checks, no browser suites). GitHub's PR run gates the merge. Inspect
  desktop and phone previews through `make -C apps/core-demo dev` while iterating.
