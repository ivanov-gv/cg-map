# UI/UX documents

- Keep user goals and journey requirements in `user-stories/` ([rules](user-stories/AGENTS.md)); keep user-facing
  feature behavior and its rationale in `features/` ([rules](features/AGENTS.md)).
- Every feature document must cite the `US-##` story IDs it serves; update the story-to-feature map when either side
  changes.
- Mark target or proposed behavior that is not implemented; do not turn a target into an implementation claim.
- Keep source-level details in the owning component and system boundaries in `../system-architecture/`.
- Keep internal editor proposals in `editor/` ([rules](editor/AGENTS.md)); they need no `US-##` IDs.
