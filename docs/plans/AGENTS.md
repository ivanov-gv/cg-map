# Task plans

- **The issue is the source of truth.** Scope, acceptance criteria, status and remaining work live in a GitHub issue.
  Split multi-PR work into sub-issues, one per PR, and record order as "blocked by" links between them.
- **The plan is the history.** It links its issue and records how the plan changed and why: dated entries for changed
  scope, reordered or dropped steps, and choices made along the way. Do not copy status or remaining work from the
  issue.
- Write a plan from `TEMPLATE.md` for multi-session work. A PR that changes the plan adds a History entry and updates
  the issue and its sub-issues in the same PR. The PR that does a sub-issue's work closes it with `Closes #N`.
- A plan stays until its issue is resolved. Delete it only then, in the PR that resolves it; git history keeps it.
- Before deleting a plan, move anything still true into the owning documentation, and its decisions into
  [the decisions log](../decisions/AGENTS.md).
- Plans written before this rule keep their status sections until they get an issue; convert them then.
- Do not treat a plan as current implementation documentation. Link current behavior to its authoritative component or
  documentation page.
