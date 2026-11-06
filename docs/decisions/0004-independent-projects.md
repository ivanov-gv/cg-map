# ADR 0004: Monorepo of mostly independent projects

Date: 2026-11-06. Status: accepted. Refines ADR 0003's concern-based monorepo.

## Decision

Each project owns its Makefile, build, run, lint, tests, instructions and CI pipeline. Projects connect only through
concrete, listed contracts. The root Makefile holds repository-wide tasks: it may call each project's check targets, and
never a project's build or run targets. CI runs one pipeline per project, chosen from the diff, so a change runs only
that project and the consumers of any contract it changed.

The projects and contracts are listed in
[current architecture](../system-architecture/architecture.md#independent-projects). Shared map libraries and fonts live
in packages/map-core rather than in one application, because every map application depends on them.

## Consequences

- A new project gets its own folder, Makefile, tests, instructions and pipeline.
- `make check` runs each project's own `verify`, so projects that need the same artifact may rebuild it. Independence is
  worth that repeated build time.
- Previewing or building an application means using that application's Makefile, for example `make -C apps/editor dev`.
