# Management

- The [management workflow](management.md) describes how work flows from the Wiki through Epics, Features, Tasks and
  Bugs to review and release.
- The wiki is the source of truth: see the note at the top of [the workflow](management.md).
- Do not invent new process. A human changes the wiki first; then an agent syncs this copy in a task that links the wiki
  change.
- The wiki is human-written: read it freely, but never edit or push to it. Propose changes as comments on the relevant
  issue so a human can apply them.

## Pull request rules

- Each Feature has its own branch and pull request to its base branch; Task and Bug PRs target the Feature branch and
  are squash-merged there.
- Open a Feature PR as a draft (`gh pr create --draft`) and mark it ready (`gh pr ready`) only when all its Tasks and
  Bugs are merged, review findings are fixed, and CI is green.
- Features of one Epic are stacked (each Feature branch based on the previous one) and linked with
  `gh stack link <bottom PR> ... <top PR>` so they merge together with `gh stack merge`.
