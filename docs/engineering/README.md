# Engineering guidelines and agent harness

This repository is set up for one maintainer working with Claude Code and Codex, one session or several in parallel. The
harness has four layers. Each fact has one canonical home; agent-specific files are generated or are thin wiring. There
are no agent hooks: they fired only for some tools (an agent editing through the shell bypassed them) and Codex required
trusting them per machine. Checks run where they cannot be bypassed: Make targets, git hooks and CI.

| Kind                                                  | Canonical home                                                       | How agents get it                                         | Backstop                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| Knowledge: architecture, domain, component boundaries | docs/system-architecture/, topic folders, component README/AGENTS.md | Routed from [AGENTS.md](../../AGENTS.md)                  | check-repo link check                              |
| Mandatory language rules                              | docs/engineering/&lt;language&gt;.md                                 | `.claude/rules` by path; links from AGENTS.md (below)     | ESLint, gofmt/vet/golangci-lint, py_compile, tests |
| Procedures                                            | Make targets and platform scripts                                    | Listed in AGENTS.md                                       | Same commands in CI                                |
| Compliance                                            | The guidelines above                                                 | A read-only review agent at the end of every task (below) | git hooks, CI                                      |

Language guidelines: [JavaScript](javascript.md), [UI](ui.md), [Python](python.md), [Go](go.md).
[Readability](readability.md) applies to all code in every language. Mapping from guideline to paths:
[platform/agents/guidelines.json](../../platform/agents/guidelines.json).

## How rules reach each agent

### Claude Code

- Reads the root AGENTS.md as project instructions, plus nested AGENTS.md files for the directories it works in. There
  is no CLAUDE.md, so instructions are not loaded twice. If a future Claude Code version stops reading AGENTS.md, add a
  root CLAUDE.md containing `@AGENTS.md` and allow it in check-repo.
- `.claude/rules/<id>.md` is generated with `paths` frontmatter. Claude loads a rule when it reads or edits a matching
  file, so Go-only work never loads the Python or UI rules. Every code file also loads the readability rule.
- `.claude/settings.json` only denies `--no-verify`.

### Codex

Codex reads AGENTS.md files from the repository root down to its **startup directory** once, including from a linked
worktree, and never loads deeper files later. It has no path-scoped rules, so:

- The root AGENTS.md, which every session loads, links to each guideline and summarizes [readability](readability.md).
- Component AGENTS.md files hold only that component's own notes. Guidelines are not copied into them, so each rule has
  one source.
- Codex gets a guideline's full text only if the agent opens the link. Checks catch what they cover, and the compliance
  review reads the guidelines itself.

## Compliance review

Loading a rule does not prove it was followed. Before reporting a task done, the agent runs a fresh read-only reviewer
over the change. The reviewer reads the guidelines for the touched paths itself and gives separate verdicts on
requirements and compliance, with file:line, rule, evidence and fix for each finding. The working agent fixes the
findings and asks the same reviewer to re-check, at most twice, and then reports any remaining findings to you.

Both come from the personal [agents plugin](https://github.com/ivanov-gv/agents), version 2.0.0 or newer, and follow its
`compliance-review` skill, so the procedure is defined once and this repository holds no copy.

- Claude Code: the `agents:compliance-reviewer` plugin agent.
- Codex: the `compliance_reviewer` agent. Codex plugins cannot ship agents, so install it once per machine with
  `./install.sh --codex-agents` from the agents repository (it goes to `~/.codex/agents`). Ask for it by name: "have
  compliance_reviewer check the change".
- Both are read-only by instruction, not by sandbox: the reviewer can run the check commands. Builds rewrite the
  worktree's dist/ and .build/, so tell the reviewer not to run them while a browser suite is running.

### Verify loading after upgrading an agent

```sh
codex --cd services/backend "List the instruction sources you loaded."   # expects root + services/backend AGENTS.md
claude -p "Read services/backend/cmd/server/main.go, then list which rule files are loaded."  # expects go.md and readability.md only
make check                                                                 # drift and budget check
```

Also run one representative task per language and confirm that the agent edits comply with the guideline. A rule being
loaded does not prove it was followed.

## Backstops that do not depend on agents

Agents can skip instructions. The checks below always run. Of [readability](readability.md), they enforce only the
mechanical rules in services/backend, through golangci-lint; everything else rests on the compliance review:

- `make setup` sets `core.hooksPath` to [platform/git-hooks](../../platform/git-hooks). pre-commit rejects commits in
  the main checkout, then runs agent-rule drift, check-repo, and all-source Markdown lint/format checks, plus
  ESLint/gofmt/py_compile on staged code. pre-push runs `make check`, plus `make check-go` when backend files changed.
  See [Markdown checks and formatting](../runbooks/development.md#markdown-checks-and-formatting).
- CI runs each affected folder's checks and browser acceptance, and `CI gate` reports the result. `main` requires it, so
  `gh pr merge --auto --squash` waits for it. `make check` runs them all locally, including `check:agents`. CI is the
  contract.

## Parallel sessions

- The main checkout is for reading and pulling main. Do not edit or commit there; pre-commit rejects commits. Run the
  commands below from it to create a worktree.
- One worktree per session: `make worktree NAME=fix-routing`, which creates `../cg-map.worktrees/fix-routing` and runs
  `make setup` there. You can also use `claude --worktree <name>` (ignored `.claude/worktrees/`). Run `make setup` in a
  new worktree before checks.
- `make -C apps/web dev`, `make -C apps/web dev-mock` and `make test-e2e` pick ports from
  [dev-port.mjs](../../platform/tools/dev-port.mjs). The main checkout keeps 8080/8095; linked worktrees get stable
  ports derived from their path. `make -C apps/editor dev` and `make -C apps/core-demo dev` add fixed offsets to the dev
  port, so they get separate origins from the public service worker. dist/ and .build/ are per worktree.
- Open the task's issue, then create a worktree and write `docs/plans/<task>.md` there from the
  [template](../plans/TEMPLATE.md) before launching a multi-session task. Split work by component so sessions touch
  disjoint directories.
- Integrate one branch at a time: rebase and resolve conflicts in the worktree, run `make check`, then merge by PR. No
  merge until [local tests pass](../../.github/TESTING.md).

## Changing the rules

- **Edit a guideline:** change docs/engineering/&lt;id&gt;.md, run `make agent-rules`, and commit the source with the
  generated files. CI fails on drift.
- **Add a language or component:** add the doc, add an entry in guidelines.json (paths), add its file type to the
  `readability` entry, add a plan in [verify.mjs](../../platform/tools/verify.mjs), run `make agent-rules`, and add one
  row to the root AGENTS.md map.
- **After an agent mistake,** prefer, in order: a lint rule or test; a tool or script; a one-line rule with its reason.
  Delete prose rules once a check enforces them.
- **Budgets enforced by the generator:** root AGENTS.md is at most 100 lines; each guideline is at most 8 KiB. Do not
  commit AGENTS.override.md.

## Personal versus committed

| Committed                                                                              | Personal (ignored or outside the repo)                                                                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| AGENTS.md, docs/, .claude/settings.json, .claude/rules (generated), platform/git-hooks | CLAUDE.local.md, .claude/settings.local.json, AGENTS.override.md, ~/.claude, ~/.codex (including the reviewer agent), model choice |

## Deliberately not added

Agent hooks (see the top of this page), project skills, compaction gates, MCP servers, sync tools such as rulesync, and
orchestrators. Add one only when a repeated, observed failure justifies it, and prefer a check over a new mechanism.
