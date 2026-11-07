# Documentation

This is the human entry point to project documentation. Each folder covers one concern and has its own `README.md` and
`AGENTS.md`; the [documentation rules](AGENTS.md) define the layout. Choose the topic that matches your question:

- [System architecture](system-architecture/README.md): implemented system boundaries, ownership, known gaps, and
  historical architecture exploration. This is not the UI/UX design area.
- [Map data](map-data/README.md): dataset terms, building-number labels, and data refresh context.
- [UI/UX](ui-ux/README.md): the path from user stories and journey requirements to justified interface and map features.
- [Verification](verification/README.md): test commands, evidence, and device-check limitations.
- [Engineering](engineering/README.md): language conventions and agent-instruction mechanisms.
- [Runbooks](runbooks/README.md): operational procedures for development, data, and release.
- [Decisions](decisions/README.md): the log of important decisions, including superseded historical choices.
- [Plans](plans/README.md): task plans and the reusable plan template.
- [Mapping research](mapping-research/README.md): exploratory research, not maintained implementation guidance.

Update docs in the same change as affected behavior. Keep each fact in one authoritative location and link to it instead
of duplicating it. Current architecture and runbooks take precedence over historical proposals and verification notes.
