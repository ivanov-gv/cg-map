# Internal source editor

Read [README.md](README.md), [architecture](../../docs/system-architecture/architecture.md),
[JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md),
[readability](../../docs/engineering/readability.md), and [contracts](../../packages/contracts/README.md).

- One source GeoJSON file equals one editing mode, keyed by its filename. Footprints and labels are independent;
  road/path kinds share roads.geojson. Every command and undo/redo may change only the active file.
- Consume the verified data-owned source bundle and public map-core entry; never import web implementation or pipeline
  code at runtime. Keep unknown properties, attribution and source identity intact.
- Dev builds on main use the repository data root and the one tools/contracts-root.mjs default for contracts. A future
  app production release pins every dependency (no production release exists yet).
- tests/ reads data through tests/pinned-data.mjs and contracts through tests/pinned-contracts.mjs, using the exact
  `@ivanov-gv/map-data` and `@ivanov-gv/map-contracts` pins. Bump a pin only in its own change after a release; never
  point tests at repository data/ or packages/contracts/. Test targets set both roots.
- Edits stay in the browser until exported as a changeset; only data/tools/apply-changeset.mjs writes reviewed sources.
  What each file allows comes from the contracts selected for the run: repository HEAD in a dev build, the app pin in
  tests. Never use a copy here or another relative path into `packages/contracts`. Keep editor validation in step with
  the importer: the integration changeset test and the shared geometry fixture enforce it. It is an offline-first app
  installed on the owner's devices from `make -C apps/editor lan`: no hosting and no auth. Do not invent editorial/auth
  APIs. Build separately; editable sources must never enter dist/web.
- This is an independent project: its Makefile, tests/e2e and ci-apps-editor pipeline are its own. Run
  `make verify PKG=apps/editor` and `make -C apps/editor e2e`, then a final `make check` for behavior. Inspect desktop
  and phone previews through `make -C apps/editor dev`.
