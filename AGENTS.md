# Working on cg-map

Start with [architecture](docs/system-architecture/architecture.md), [ownership](docs/system-architecture/ownership.md),
and the relevant component's AGENTS.md. This is a read-only map PoC; do not invent backend APIs or editorial services
that do not exist.

## Monorepo of independent projects

Each project below is mostly independent: it owns its Makefile, build, run, lint, tests, instructions and CI pipeline.
Projects connect only through the [concrete contracts](docs/system-architecture/architecture.md#independent-projects).
The root Makefile never runs a project's build or run targets, and no project runs another project's checks. Add a
project the way that section describes.

## Repo map and language rules

Read the matching guideline before planning, editing, or reviewing code in that language. Claude Code loads them
automatically by path; other agents must open the linked file.

| Path                                                     | What                                                          | Guidelines                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| apps/web, apps/editor, apps/core-demo, packages/map-core | Separate browser apps and their shared map runtime            | [javascript](docs/engineering/javascript.md), [ui](docs/engineering/ui.md), [python](docs/engineering/python.md) |
| data                                                     | Sources, imagery, releases, pipeline tools                    | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| services/backend                                         | Independent Go server: static host, layers and transport APIs | [go](docs/engineering/go.md)                                                                                     |
| services/transit-relay                                   | Read-only live bus relay (Node)                               | [javascript](docs/engineering/javascript.md)                                                                     |
| packages/contracts                                       | Shared producer/consumer formats                              | Producer and consumer review together                                                                            |
| platform, .github                                        | Dev/release tooling, agent harness, CI                        | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| tests                                                    | Cross-component contract and artifact integration             | [javascript](docs/engineering/javascript.md)                                                                     |

How the harness loads rules and how to add a language: [docs/engineering/README.md](docs/engineering/README.md).

## Repository-wide commands, from the root (never invent others)

- `make setup`: install pinned npm dependencies (Node 24; `gh` needs `read:packages`) and enable git hooks.
- `npm run lint:md` / `npm run format:md`: check all Markdown / fix authored sources and regenerate .claude/rules.
- `make verify PKG=<path>`: lint and test the component that owns a path; without PKG it runs everything.
- `make check`: `verify` in every project but services/backend; `make check-go` checks that Go module.
- `make check-docs`: all Markdown, repository checks, and agent rules, with no web build.
- `make ci-plan BASE=origin/main`: show which CI pipelines and browser areas a branch selects.
- `make test-<workflow>` / `make test-all-workflows`: run workflows locally with `act`, as `.github/TESTING.md` requires
  for `.github/**` changes.
- `gh pr merge --auto --squash`: merge when `CI gate` passes, which `main` requires and needs an approved run.
- `make test-e2e`: browser tests of every browser project, each building itself first.
- `make agent-rules`: regenerate .claude/rules after editing docs/engineering or platform/agents/guidelines.json.
- `make worktree NAME=<branch>`: isolated checkout for a session; commits need one.

## Project commands, from each project's own Makefile

- `make -C apps/<name> build|dev|e2e`: assemble, preview or browser-test that app; `E2E_ARGS=...` filters tests.
- `make -C apps/web dev`: server mode, needs Go; `DEV_FLAGS=-live-transport=false` skips upstream. `dev-mock`: as Pages.
- `make -C data build-data`: expensive geography rebuild; requires data/tools/requirements.txt.

## Hard rules

- **No merge until local tests pass**, and `.github/**` changes pass under act: [the rule](.github/TESTING.md).
- Never delete, skip, or loosen a failing test, check, or provenance record to get green output. Never commit with
  `--no-verify`.
- Never edit or commit in the main checkout; it is for reading and pulling main. Work in your own worktree:
  `make worktree NAME=<branch>`. A pre-commit hook rejects commits there.
- Never hand-edit generated output: dist/web, .build, .claude/rules. Edit the source and regenerate.
- Do not refresh data or regenerate geography as an incidental step in another task.
- Read [readability](docs/engineering/readability.md) before planning, editing, or reviewing any code, in any language,
  on any path. All code you add or change must meet it: meaningful whole-word names, short functions that read as steps,
  and comments that explain why. Do not match a denser surrounding style.
- Cross-boundary changes need explicit contract/ownership consideration; contract changes update producer validation and
  consumer tests together.
- No application copies, binaries, or temporary assets in repository root.

## Ownership and generated output

- apps/web owns public browser code, assets, and web build/tests. packages/map-core owns shared map runtime; apps/editor
  and apps/core-demo own their internal viewers. services/backend owns the Go module and future backend/editorial
  implementation.
- data owns editable sources, imagery, validated releases, and pipeline tools/tests. data/artifacts holds the reviewed
  snapshot so a clean checkout builds without a geography import.
- platform owns development/release infrastructure and the agent harness; GitHub-specific configuration lives in
  .github.
- tests/ owns cross-component acceptance; component-specific tests live with their component.

## Workflow: task, plan, PR, decisions log

1. Inspect git status, acceptance criteria and open PRs for the same scope; preserve unrelated work.
2. Read component instructions and language guidelines. For work spanning sessions, write a plan from
   [the template](docs/plans/TEMPLATE.md) first. Delete a plan [only when its work is finished](docs/plans/AGENTS.md).
3. Make a bounded change, with its docs. Keep runtime modules independent of pipeline/server implementation.
4. Follow the owning component's AGENTS.md for focused tests during iteration and required final verification.
5. Run the compliance review: Claude Code `agents:compliance-reviewer`, Codex `compliance_reviewer`
   ([how](docs/engineering/README.md#compliance-review)). Fix findings; at most two re-checks.
6. Report executed checks, review findings left open, and limitations.
7. In the PR, add a [decision record](docs/decisions/AGENTS.md), or state that it made no important decision.

## Invariants

- Libraries, fonts, imagery, and basemap data are local runtime assets. Optional live transport uses a network relay
  only while enabled; route requests use external car/foot services. Never store live positions or external route
  responses offline. Dated bus patterns may be bundled.
- Range/archive responses stay outside the service-worker shell cache.
- Existing verified offline downloads survive unsuccessful replacements.
- Data producers depend on shared contracts, not web implementation.
- Keep source provenance and licensing intact. Legacy geometry does not have reliable upstream identity.
- Isolate simultaneous work in separate worktrees; keep secrets out of Git and artifacts.
