# Working on cg-map

Start with [architecture](docs/system-architecture/architecture.md), [ownership](docs/system-architecture/ownership.md),
and the relevant component's AGENTS.md. This is a read-only map PoC; do not invent backend APIs or editorial services
that do not exist.

## Repo map and language rules

Read the matching guideline before planning, editing, or reviewing code in that language. Claude Code loads them
automatically by path, and Codex receives them from component AGENTS.md files. If one is missing from your context, read
the file.

| Path                   | What                                                          | Guidelines                                                                                                       |
| ---------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| apps/web               | Browser app: MapLibre UI, offline, build                      | [javascript](docs/engineering/javascript.md), [ui](docs/engineering/ui.md), [python](docs/engineering/python.md) |
| data                   | Sources, imagery, releases, pipeline tools                    | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| services/backend       | Independent Go server: static host, layers and transport APIs | [go](docs/engineering/go.md)                                                                                     |
| services/transit-relay | Read-only live bus relay (Node)                               | [javascript](docs/engineering/javascript.md)                                                                     |
| packages/contracts     | Shared producer/consumer formats                              | Producer and consumer review together                                                                            |
| platform, .github      | Dev/release tooling, agent harness, CI                        | [javascript](docs/engineering/javascript.md), [python](docs/engineering/python.md)                               |
| tests                  | Cross-component contract and artifact integration             | [javascript](docs/engineering/javascript.md)                                                                     |

How the harness loads rules and how to add a language: [docs/engineering/README.md](docs/engineering/README.md).

## Commands from repository root (never invent others)

- `make setup`: install pinned npm dependencies (Node 24) and enable git hooks.
- `npm run lint:md` / `npm run format:md`: check all Markdown / fix authored sources and regenerate agent adapters.
- `make verify PKG=<path>`: lint and test the component that owns a path; without PKG it runs everything.
- `make check`: lint, source/release validation, docs/boundaries, agent-rule drift, web build, Node/Python tests,
  offline manifests.
- `make check-go`: vet/test/build the independent services/backend Go module.
- `make check-docs`: all Markdown, repository checks, and agent rules, with no web build.
- `make ci-plan BASE=origin/main`: show which CI pipelines and browser areas a branch selects.
- `make test-<workflow>` / `make test-all-workflows`: run workflows locally with `act`, as `.github/TESTING.md` requires
  for `.github/**` changes.
- `make dev`: build web and run the Go backend (server mode) on a per-worktree port; needs Go.
  `DEV_FLAGS=-live-transport=false` skips upstream calls.
- `make dev-mock`: build web and serve static dist/web (mock mode, as on GitHub Pages).
- `make build`: assemble the current web artifact without regenerating geography.
- `make build-data`: expensive geography rebuild; requires data/tools/requirements.txt.
- `make agent-rules`: regenerate agent adapters after editing docs/engineering or platform/agents/guidelines.json.
- `make worktree NAME=<branch>`: isolated checkout for a session; commits need one.

## Hard rules

- Never delete, skip, or loosen a failing test, check, or provenance record to get green output. Never commit with
  `--no-verify`.
- Never edit or commit in the main checkout; it is for reading and pulling main. Work in your own worktree:
  `make worktree NAME=<branch>`. A pre-commit hook rejects commits there.
- Never hand-edit generated output: dist/web, .build, .claude/rules, or the `BEGIN GENERATED` blocks in AGENTS.md files.
  Edit the source and regenerate.
- Do not refresh data or regenerate geography as an incidental step in another task.
- Cross-boundary changes need explicit contract/ownership consideration; contract changes update producer validation and
  consumer tests together.
- No application copies, binaries, or temporary assets in repository root.

## Ownership and generated output

- apps/web owns browser code, public assets, and web build/tests. services/backend owns the Go module and future
  backend/editorial implementation.
- data owns editable sources, imagery, validated releases, and pipeline tools/tests. data/artifacts holds the reviewed
  snapshot so a clean checkout builds without a geography import.
- platform owns development/release infrastructure and the agent harness; GitHub-specific configuration lives in
  .github.
- tests/ owns cross-component acceptance; component-specific tests live with their component.

## Workflow

1. Inspect git status and acceptance criteria; preserve unrelated work.
2. Read component instructions and language guidelines. For work spanning sessions, write a plan from
   [the template](docs/plans/TEMPLATE.md) first.
3. Make a bounded change. Keep runtime modules independent of pipeline/server implementation.
4. Follow the owning component's AGENTS.md for focused tests during iteration and required final verification.
5. Update docs in the same change as behavior or architecture changes.
6. Run the compliance review: Claude Code `agents:compliance-reviewer`, Codex `compliance_reviewer`
   ([how](docs/engineering/README.md#compliance-review)). Fix findings; at most two re-checks.
7. Report executed checks, review findings left open, and limitations.

## Invariants

- Libraries, fonts, imagery, and basemap data are local runtime assets. Optional live transport uses a network relay
  only while enabled; route requests use external car/foot services. Never store live positions or external route
  responses offline. Dated bus patterns may be bundled.
- Range/archive responses stay outside the service-worker shell cache.
- Existing verified offline downloads survive unsuccessful replacements.
- Data producers depend on shared contracts, not web implementation.
- Keep source provenance and licensing intact. Legacy geometry does not have reliable upstream identity.
- Isolate simultaneous work in separate worktrees; keep secrets out of Git and artifacts.
