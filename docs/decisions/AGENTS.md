# Decision records

- A PR that makes or implements an important decision adds one new record from [the template](TEMPLATE.md), numbered
  next after the last on main. Important means someone later would ask why it is this way: architecture, process,
  ownership, or a trade-off with a lasting cost.
- A PR with no such decision adds no record and says so in its description, under Decisions.
- `make check-docs` fails on a gap, a repeated number, or a title that disagrees with the file name. If another PR took
  your number first, take the next one.
- Preserve accepted ADRs as historical records; do not rewrite their original decision to match later architecture.
- Add a new record when a decision changes materially and link it to current guidance.
- Keep the implemented state in [system architecture](../system-architecture/README.md), not in an ADR alone.
