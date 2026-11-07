# Development

Requirements: Node 24, Python 3.12, and Go (for `make -C apps/web dev` and backend checks). Component boundaries and
ownership are in [ownership](../system-architecture/ownership.md).

```sh
make setup
make -C apps/web dev
```

make setup also points git at platform/git-hooks (fast pre-commit checks; make check on pre-push). The root Makefile
holds repository-wide tasks only; each project's own Makefile holds its build, run and test targets. npm workspaces are
apps/web, apps/editor, apps/core-demo, packages/map-core and data; services/backend is an independent Go module.
`make -C apps/web dev` builds dist/web and runs the Go backend on it in server mode (layers and live transport APIs;
pass `DEV_FLAGS=-live-transport=false` to avoid upstream calls). `make -C apps/web dev-mock` serves dist/web statically
in mock mode, like GitHub Pages. Both serve generated dist/web, not repository source. `make -C apps/editor dev` and
`make -C apps/core-demo dev` build and serve the separate internal viewers. Each worktree gets its own stable dev and
e2e port; override with PORT or E2E_PORT. Rebuild/restart after source edits; no hot reload is configured.

```sh
make check
npx playwright install chromium
make test-e2e
make check-go
```

make check runs each project's own `verify`. make test-e2e runs each browser project's own browser tests; each builds
its artifact and tests it at / and /cg-map/. Browser artifacts in each project's test-results are ignored locally and
uploaded on CI failure.

## Faster browser tests

Browser tests run one at a time with software rendering by default. On a machine with threads and a GPU to spare, this
is about four times faster, with the same tests:

```sh
E2E_WORKERS=6 E2E_ANGLE=gl-egl make -C apps/web e2e
```

`E2E_ANGLE` also takes `vulkan`. Keep the default if the GPU is unavailable. A pass this way does not replace the run CI
does.

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
`format:md` fixes authored sources and regenerates agent rules; it never formats generated rules directly. Fix any
remaining semantic lint findings manually.

Markdown checks run automatically in `make check`, `make verify PKG=docs`, `make verify PKG=platform`, and the
pre-commit/pre-push hooks installed by `make setup`. CI runs the same project checks, one pipeline per project, and the
docs pipeline for Markdown-only changes. Checks report failures without rewriting or staging working files; formatting
is an explicit command.

GoLand's [built-in Markdown formatter and inspections](https://www.jetbrains.com/help/go/markdown.html) are separate
tools. The shared rules cover its table-alignment and ordered-list conventions; the CLI checks are authoritative for the
repository. Editor integrations that support Prettier/markdownlint can read the root configurations; enabling
format-on-save is an editor preference, not required for automatic commit/CI enforcement.

The root package pins both tools and overrides markdownlint's RE2JS and math parser's KaTeX dependencies to patched
releases. Keep these compatibility-tested overrides while the pinned upstream packages still request vulnerable
versions.

Each project's Makefile owns its build, run and checks; the root only runs repository-wide tasks.
`make verify PKG=<path>` delegates to the owning component. For example:

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
remaining work explicit. A PR that makes an important decision adds a record to the
[decisions log](../decisions/AGENTS.md); a PR that makes none says so in its description. Commit only from a worktree,
even when working alone: `make worktree NAME=<branch>`. The main checkout rejects commits. See
[parallel sessions](../engineering/README.md#parallel-sessions).
