# Internal source editor

Read [README.md](README.md), [architecture](../../docs/system-architecture/architecture.md),
[JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md),
[readability](../../docs/engineering/readability.md), and [contracts](../../packages/contracts/README.md).

- Source layout and unit test locations are in [README.md](README.md#source-layout). The ten layers are listed in
  `src/layers/shared/editor-layers.js`. One layer is active; a command or undo step may change only that layer's files,
  as one step; an imported changeset is the exception and is taken back whole
  ([ADR 0038](../../docs/decisions/0038-editor-layers-span-files.md)). What a layer does differently belongs in its
  behavior (`src/layers/shared/layer-behaviors.js`), never in `app.js`.
- Consume the verified data-owned source bundle and public map-core entry; never import web implementation or pipeline
  code at runtime. Keep unknown properties, attribution and source identity intact.
- Non-release builds (`build`, `dev`, `lan`, CI artifact, dev Pages) bundle this commit's core through the one
  tools/core-root.mjs default, with the repository data and contracts roots. `build-release` pins all three from this
  app's package.json and refuses another core
  ([ADR 0046](../../docs/decisions/0046-editor-builds-take-their-own-core.md)).
- tests/ reads core through tests/pinned-core.mjs, data through tests/pinned-data.mjs and contracts through
  tests/pinned-contracts.mjs, using the exact pins in package.json. Bump a pin only in its own change after a release;
  never point tests at repository data/ or packages/contracts/. Test targets set all three roots. Layers the pins lack
  are tested on the fixture city (tests/e2e/fixture-city.mjs), the app's own files.
- Edits stay in the browser until exported as a changeset; only data/tools/apply-changeset.mjs writes reviewed sources.
  What each file allows comes from the contracts selected for the run: repository HEAD in a dev build, the app pin in
  tests. Never use a copy here or another relative path into `packages/contracts`. Keep editor validation in step with
  the importer: the integration changeset test and the shared geometry fixture enforce it. It is an offline-first app
  installed on the owner's devices from `make -C apps/editor lan`: no hosting and no auth. Do not invent editorial/auth
  APIs. Build separately; editable sources must never enter dist/web.
- The browser suite is split into the shards counted in `browser-jobs.json`; `tools/browser-matrix.mjs` builds the CI
  matrix from that one number. Keep the number in the editor, never in platform tooling. Any editor change runs all
  shards; [workflow testing](../../.github/TESTING.md#on-github) owns the smoke and full-run rule. Keep specs and
  per-file area lists out of the platform planner; prove a changed job count for both phone modes with
  `E2E_WORKERS=2 E2E_PHONE=tagged npx playwright test --list --shard=i/N` and
  `E2E_WORKERS=2 E2E_PHONE=all npx playwright test --list --shard=i/N` for every shard, matching CI's worker count.
- This is an independent project: its Makefile, tests/e2e and ci-apps-editor pipeline are its own. Local
  `make verify PKG=apps/editor` and `make -C apps/editor e2e` are optional for iterating; the pre-push `make check` is
  required (builds and non-browser checks, no browser suites). GitHub's PR run gates the merge. Inspect desktop and
  phone previews through `make -C apps/editor dev` while iterating.
