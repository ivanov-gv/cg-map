# Documentation structure

- Keep only `README.md`, `AGENTS.md`, and concern-named directories at the `docs/` root.
- Give every directory under `docs/` one distinct concern and a name that identifies it without ambiguity.
- Put a human `README.md` and an agent `AGENTS.md` in every `docs/` directory, including the root.
- Keep system architecture distinct from UI/UX design; do not use generic folder names such as `design` for
  architecture.
- Keep one authoritative home per fact, use relative links, and update links whenever documents move.
- Preserve decision records as historical records; label historical guidance and defer to current docs.
- A plan records the history of an issue, which is the source of truth; delete it only in the PR that resolves that
  issue, as [the plan rules](plans/AGENTS.md) describe.
- Add a record to [the decisions log](decisions/AGENTS.md) from any PR that makes an important decision.
- Run `make verify PKG=docs` after documentation changes.

Use the [documentation index](README.md) to find each folder's scope and source documents. Before editing a folder, read
its rules: [decisions](decisions/AGENTS.md), [engineering](engineering/AGENTS.md), [map data](map-data/AGENTS.md),
[management](management/AGENTS.md), [mapping research](mapping-research/AGENTS.md), [plans](plans/AGENTS.md),
[runbooks](runbooks/AGENTS.md), [system architecture](system-architecture/AGENTS.md), [UI/UX](ui-ux/AGENTS.md) and
[verification](verification/AGENTS.md).
