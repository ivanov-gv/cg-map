# Management

- The [management workflow](management.md) describes how work flows from the Wiki through Epics, Features, Tasks and
  Bugs to review and release.
- The wiki is the source of truth: see the note at the top of [the workflow](management.md).
- Do not invent new process. A human changes the wiki first; then an agent syncs this copy in a task that links the wiki
  change.
- The wiki is human-written: read it freely, but never edit or push to it. Propose changes as comments on the relevant
  issue so a human can apply them.

## Issue rules

Follow [GitHub Issues in the workflow](management.md#github-issues) for every issue you open or change:

- Open it with its type (Epic, Feature, Task or Bug), a `project/<area>` label (plus a sub-label such as `platform/ci`
  or `process` where one fits) and the current open milestone. Never add them later.
- Keep [the hierarchy](management.md#epics): an Epic holds only Features; a Feature has an Epic parent and holds only
  Tasks and Bugs; a Task or Bug has a Feature parent. Link parents as sub-issues when you open the issue.
- A fix found after a Feature merged is a Task or Bug under that Feature, and its PR targets `main` (owner, 2026-11-23).
  Do not reopen the Feature branch for it.
- The milestone and the after-merge rule come from the owner (2026-11-23) and are not yet in the wiki copy in
  [management.md](management.md); proposed for the wiki in #363.

## Pull request rules

- Each Feature has its own branch and pull request to its base branch; Task and Bug PRs target the Feature branch and
  are squash-merged there.
- Task and Bug PRs write `Closes #N`, but GitHub closes issues only on merges into main: after a Task or Bug PR merges
  into its Feature branch, close the issue with a comment naming the PR. The Feature PR writes `Closes #<feature>`.
- A Feature PR opens as a draft (`gh pr create --draft`). It is ready for review (`gh pr ready`) when its Tasks and Bugs
  are merged, review findings are fixed and CI is green.
- Merge a stack only with `gh stack merge <stack> --squash`, once every PR in it is ready for review and its CI gate
  passes. Never merge one member of a stack with `gh pr merge`.
- Features of one Epic are stacked (each Feature branch based on the previous one) and linked with
  `gh stack link <bottom PR> ... <top PR>` so they merge together with `gh stack merge`.
