# Working on cg-map

Start with [architecture](docs/system-architecture/architecture.md), [ownership](docs/system-architecture/ownership.md),
and the AGENTS.md of every path you touch, linked below (docs: [docs/AGENTS.md](docs/AGENTS.md)); open them yourself, as
not every agent loads nested files. This is a read-only map PoC; do not invent backend APIs or editorial services.

## Monorepo of independent projects

Each project below is mostly independent: it owns its Makefile, build, run, lint, tests, instructions and CI pipeline.
Projects connect only through the [concrete contracts](docs/system-architecture/architecture.md#independent-projects).
The root Makefile never runs a project's build or run targets, and no project runs another project's checks. A project's
tests read only its own files or an exact published version of another project (such as `@ivanov-gv/map-data`), never
its HEAD; only [tests](tests/AGENTS.md) and data's contract checks read HEAD. Add projects as that section describes.

## Repo map and language rules

Read the matching guideline before planning, editing, or reviewing code in that language;
[testing](docs/engineering/testing.md) before changing tests. Claude Code loads them by path; other agents open them.

| Path                                                                                                                                                               | What                                                          | Guidelines                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [apps/web](apps/web/AGENTS.md), [apps/editor](apps/editor/AGENTS.md), [apps/core-demo](apps/core-demo/AGENTS.md), [packages/map-core](packages/map-core/AGENTS.md) | Separate browser apps and their shared map runtime            | [javascript](docs/engineering/javascript.md), [ui](docs/engineering/ui.md), [python](docs/engineering/python.md) |
| [data](data/AGENTS.md)                                                                                                                                             | Sources, imagery, releases, pipeline tools                    | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| [services/backend](services/backend/AGENTS.md)                                                                                                                     | Independent Go server: static host, layers and transport APIs | [go](docs/engineering/go.md)                                                                                     |
| [services/transit-relay](services/transit-relay/AGENTS.md)                                                                                                         | Read-only live bus relay (Node)                               | [javascript](docs/engineering/javascript.md)                                                                     |
| [packages/contracts](packages/contracts/AGENTS.md)                                                                                                                 | Shared producer/consumer formats                              | Producer and consumer review together                                                                            |
| [platform](platform/AGENTS.md), [.github](.github/TESTING.md)                                                                                                      | Dev/release tooling, agent harness, CI                        | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| [tests](tests/AGENTS.md)                                                                                                                                           | Cross-component contract and artifact integration             | [javascript](docs/engineering/javascript.md)                                                                     |

How the harness loads rules and how to add a language: [docs/engineering/README.md](docs/engineering/README.md).

## Repository-wide commands, from the root (never invent others)

- `make setup`: install pinned npm dependencies (Node 24; `gh` needs `read:packages`) and enable git hooks.
- `npm run lint:md` / `npm run format:md`: check all Markdown / fix authored sources and regenerate .claude/rules.
- `make verify PKG=<path>`: lint and test the component that owns a path; without PKG it runs everything.
- `make check` (the pre-push hook): `verify` in every project but services/backend, no browser suites; `make check-go`
  checks that Go module. `make check-docs`: all Markdown, repository checks, and agent rules, with no web build.
- `make ci-plan BASE=origin/main`: show which CI pipelines and browser areas a branch selects.
- `make lint-workflows` (required for `.github/**`), `make test-<workflow>` / `make test-all-workflows`: lint, act run.
- `gh pr merge --auto --squash`: merge when `CI gate` passes, which `main` requires and needs an approved run.
- `make test-e2e`: optional local browser tests of every browser project, each building itself first.
- `make agent-rules`: regenerate .claude/rules after editing docs/engineering or platform/agents/guidelines.json.

## Project commands, from each project's own Makefile

- `make -C apps/<name> build|dev|e2e`: assemble, preview or browser-test that app; `E2E_ARGS=...` filters tests.
- `make -C apps/web dev`: server mode, needs Go; `DEV_FLAGS=-live-transport=false` skips upstream. `dev-mock`: as Pages.
- `make -C data build-data`: expensive geography rebuild; requires data/tools/requirements.txt.

## Hard rules

- **Before v1, break compatibility for the right structure**
  ([why](docs/decisions/0039-strong-foundation-before-v1.md)): store each fact once, link by ID, derive the rest. A
  country links to its border lines; no check compares copies, no override or view-only field hides a wrong value.
- **Merge only when [tests pass on GitHub](.github/TESTING.md)**; locally the pre-push `make check` is required.
- **No CI/CD change reaches main unproved:** [prove it on the branch](.github/TESTING.md#prove-cicd-before-main).
- Never delete, skip, or loosen a failing test, check, or provenance record for green output. Never use `--no-verify`.
- Never edit or commit in the main checkout (for reading and pulling main only); use `make worktree NAME=<branch>`.
- Never hand-edit generated output: dist/web, .build, .claude/rules. Edit the source and regenerate.
- Do not refresh data or regenerate geography as an incidental step in another task.
- Read [readability](docs/engineering/readability.md) before planning, editing, or reviewing any code, in any language,
  on any path. All code you add or change must meet it: meaningful whole-word names, short functions that read as steps,
  and comments that explain why. Do not match a denser surrounding style.
- Cross-boundary changes need explicit contract/ownership consideration; a contract change updates producer validation,
  tests/, and the next `@ivanov-gv/map-contracts` release, while consumers pin that release.
- No application copies, binaries, or temporary assets in repository root.

## Ownership and generated output

- data owns editable sources, imagery, validated releases, and pipeline tools/tests. data/artifacts holds the reviewed
  snapshot so a clean checkout builds without a geography import.
- platform owns development/release infrastructure and the agent harness; GitHub-specific config lives in .github.
- tests/ owns cross-component acceptance; component-specific tests live with their component.

## Workflow: task, plan, PR, decisions log

Work starts in the human-written wiki: read it, never edit it; propose changes as issue comments. Before anything with
issues, pull requests, Feature branches, stacks or merges, read [docs/management/AGENTS.md](docs/management/AGENTS.md).

1. Find or open the task's issue; every PR needs one. Inspect git status and open PRs; preserve unrelated work.
2. Read component instructions and language guidelines. Track work spanning sessions in an issue, with its plan as
   history: [plan rules](docs/plans/AGENTS.md).
3. Make a bounded change, with its docs. Keep runtime modules independent of pipeline/server implementation.
4. Follow the owning component's AGENTS.md for focused tests during iteration; GitHub runs the final verification.
5. Run the compliance review: Claude Code `agents:compliance-reviewer`, Codex `compliance_reviewer`
   ([how](docs/engineering/README.md#compliance-review)). Fix findings; at most two re-checks.
6. Report executed checks, review findings left open, and limitations.
7. Write the PR from [the template](.github/pull_request_template.md): its issue link and Decisions section.

## Invariants

- Libraries, fonts, imagery, and basemap data are local runtime assets. Optional live transport uses a network relay
  only while enabled; route requests use external car/foot services. Never store live positions or external route
  responses offline. Dated bus patterns may be bundled.
- Range/archive responses stay outside the service-worker shell cache.
- Existing verified offline downloads survive unsuccessful replacements.
- Data producers depend on shared contracts, not web implementation.
- Keep source provenance and licensing intact. Legacy geometry does not have reliable upstream identity.
- Isolate simultaneous work in separate worktrees; keep secrets out of Git and artifacts.
