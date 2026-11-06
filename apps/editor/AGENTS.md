# Internal source editor

Read [README.md](README.md), [architecture](../../docs/system-architecture/architecture.md),
[JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md),
[readability](../../docs/engineering/readability.md), and [contracts](../../packages/contracts/README.md).

- One source GeoJSON file equals one editing mode, keyed by its filename. Footprints and labels are independent;
  road/path kinds share roads.geojson. Every command and undo/redo may change only the active file.
- Consume the verified data-owned source bundle and public map-core entry; never import web implementation or pipeline
  code at runtime. Keep unknown properties, attribution and source identity intact.
- Edits stay in the browser until exported as a changeset; only data/tools/apply-changeset.mjs writes reviewed sources.
  What each file allows comes from packages/contracts/editor-layers.json, never from a copy here. Keep editor validation
  in step with the importer: tests/integration/editor-changeset.test.mjs and the shared geometry fixture enforce it. Do
  not invent editorial/auth APIs. Build separately; editable sources must never enter dist/web.
- This is an independent project: its Makefile, tests/e2e and ci-apps-editor pipeline are its own. Run
  `make verify PKG=apps/editor` and `make -C apps/editor e2e`, then a final `make check` for behavior. Inspect desktop
  and phone previews through `make -C apps/editor dev`.
