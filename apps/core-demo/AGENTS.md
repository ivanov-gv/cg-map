# Core concept app

Read [README.md](README.md), [JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md), and
[readability](../../docs/engineering/readability.md).

- Import only packages/map-core/src/index.js. No editor/web implementation, local helper modules, storage or product
  workflows. Keep one map and simple independent concept controls.
- tests/ reads data through tests/pinned-data.mjs and the exact `@ivanov-gv/map-data` pin. Bump that pin only in its own
  change after a release; never point tests at repository data/. Dev builds on main use the repository data root; a
  future app production release pins every dependency, data included (no production release exists yet).
- Use local assets and relative URLs; show async and map failures. Keep touch targets and visible keyboard focus.
- This is an independent project: its Makefile, tests/e2e and ci-apps-core-demo pipeline are its own. Run
  `make verify PKG=apps/core-demo` and `make -C apps/core-demo e2e`, then a final `make check`. Inspect desktop and
  phone previews through `make -C apps/core-demo dev`.
