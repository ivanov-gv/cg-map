# Documentation structure

- Keep only `README.md`, `AGENTS.md`, and concern-named directories at the `docs/` root.
- Give every directory under `docs/` one distinct concern and a name that identifies it without ambiguity.
- Put a human `README.md` and an agent `AGENTS.md` in every `docs/` directory, including the root.
- Keep system architecture distinct from UI/UX design; do not use generic folder names such as `design` for
  architecture.
- Keep one authoritative home per fact, use relative links, and update links whenever documents move.
- Preserve decision records as historical records; label historical guidance and defer to current docs.
- Delete a plan in the PR that completes it, as [the plan rules](plans/AGENTS.md) describe.
- Run `make verify PKG=docs` after documentation changes.

Use the [documentation index](README.md) to find each folder's scope and source documents.
