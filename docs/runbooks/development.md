# Development

Requirements: Node 24, Python 3.12, and Go (for `make dev` and backend checks). Component boundaries and ownership are
in [ownership](../system-architecture/ownership.md).

```sh
make setup
make dev
```

make setup also points git at platform/git-hooks (fast pre-commit checks; make check on pre-push). The root Makefile
orchestrates component commands. npm workspaces are apps/web and data; services/backend is an independent Go module.
`make dev` builds dist/web and runs the Go backend on it in server mode (layers and live transport APIs; pass
`DEV_FLAGS=-live-transport=false` to avoid upstream calls). `make dev-mock` serves dist/web statically in mock mode,
like GitHub Pages. Both serve generated dist/web, not repository source. Each worktree gets its own stable dev and e2e
port; override with PORT or E2E_PORT. Rebuild/restart after source edits; no hot reload is configured.

```sh
make check
npx playwright install chromium
make test-e2e
make check-go
```

make check validates lint, data sources/release, docs, boundaries, the assembled web artifact, Node/Python tests, and
offline manifests. make test-e2e builds the app and tests the actual artifact at / and /cg-map/. Browser artifacts in
apps/web/test-results are ignored locally and uploaded on CI failure.

## Markdown checks and formatting

All repository `.md` files, including new/untracked documents, dot directories, and component instructions, use the root
`.markdownlint.jsonc` and `.prettierrc.json` rules. Dependencies, ignored build output, and other `.gitignore` entries
are outside the source check.

```sh
npm run lint:md
npm run format:md
```

`lint:md` checks structure with markdownlint and formatting with Prettier: aligned tables, ordered numbering, consistent
fences, whitespace, and blank lines. Prose is hard-wrapped at 120 columns, matching the Markdown margin in
`.editorconfig`. Table rows, code blocks, and indivisible URLs may exceed that width so their structure stays intact.
`format:md` fixes authored sources and regenerates agent adapters; it never formats generated adapters directly. Fix any
remaining semantic lint findings manually.

Markdown checks run automatically in `npm run lint`, `make check`, `make verify PKG=docs`, `make verify PKG=platform`,
and the pre-commit/pre-push hooks installed by `make setup`. CI runs the same `make check`, including for backend-only
Markdown changes. Checks report failures without rewriting or staging working files; formatting is an explicit command.

GoLand's [built-in Markdown formatter and inspections](https://www.jetbrains.com/help/go/markdown.html) are separate
tools. The shared rules cover its table-alignment and ordered-list conventions; the CLI checks are authoritative for the
repository. Editor integrations that support Prettier/markdownlint can read the root configurations; enabling
format-on-save is an editor preference, not required for automatic commit/CI enforcement.

The root package pins both tools and overrides markdownlint's RE2JS and math parser's KaTeX dependencies to patched
releases. Keep these compatibility-tested overrides while the pinned upstream packages still request vulnerable
versions.

Component Makefiles own targeted checks; root commands remain orchestration aliases. `make verify PKG=<path>` delegates
to the owning component. For example:

```sh
make -C apps/web verify
make -C data verify
make -C services/backend check
make -C packages/contracts verify
make -C tests verify
make -f platform/docs.mk lint
make verify PKG=docs/system-architecture/ownership.md
```

Run `make -f platform/docs.mk lint` after documentation edits for a docs-scoped Markdown check. It is an explicit
command, not an on-save hook; the repository-wide Markdown check still runs in `make check`, CI, and the installed Git
hooks.

Use [the plan template](../plans/TEMPLATE.md) for multi-session work. Keep acceptance criteria, progress, decisions, and
remaining work explicit. Commit only from a worktree, even when working alone: `make worktree NAME=<branch>`. The main
checkout rejects commits. See [parallel sessions](../engineering/README.md#parallel-sessions).
