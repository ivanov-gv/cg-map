# Editor UI/UX documents

- Keep interface proposals for `apps/editor` here; keep current behaviour in `apps/editor/README.md`.
- Mark every proposal's status and list where it departs from the current editor. Never present it as implemented.
- Take editing permissions from `packages/contracts/editor-layers.json`; a proposal must not grant new kinds of edit.
- `docs/` holds Markdown only: attach screenshots to the pull request, and describe in the proposal what each shows and
  does not show.
- When a proposal is implemented, move its lasting behaviour into the editor README and delete or update the proposal.
