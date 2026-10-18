# Working on cg-map

Start with [ARCHITECTURE.md](ARCHITECTURE.md), [ownership](docs/ownership.md), and the relevant component's AGENTS.md. This is a read-only map PoC; do not invent backend APIs or editorial services that do not exist.

## Commands from repository root

- `make setup`: install pinned npm workspace dependencies (Node 24).
- `make dev`: build web and serve dist/web on localhost; set PORT for another worktree.
- `make check`: lint, source/release validation, docs/boundaries, web build, Node/Python tests, offline manifest checks.
- `make test-e2e`: browser acceptance; install Chromium with `npx playwright install chromium` first.
- `make check-go`: vet/test/build the independent services/backend Go module.
- `make build`: assemble the current web artifact without regenerating geography.
- `make build-data`: expensive geography rebuild; requires data/tools/requirements.txt.

## Ownership and generated output

- apps/web owns browser code, public assets, and web build/tests.
- services/backend owns the Go module and future backend/editorial implementation.
- data owns editable sources, imagery, validated releases, and pipeline tools/tests.
- packages/contracts owns producer/consumer formats; changes require both sides' review.
- platform owns development/release infrastructure; GitHub-specific configuration lives in .github.
- tests/ owns cross-component acceptance; component-specific tests live with their component.
- dist/web and .build are generated and ignored. Never commit or hand-edit them.
- data/artifacts contains the reviewed current data snapshot so a clean checkout can build the web without a full geography import.

## Workflow

1. Inspect git status and acceptance criteria; preserve unrelated work.
2. Read component instructions. Cross-boundary changes need explicit contract/ownership consideration.
3. Make a bounded change. Keep runtime modules independent of pipeline/server implementation.
4. Run relevant component checks, then make check. Run browser acceptance for web/offline/release changes and check-go for backend changes.
5. Update docs with behavior changes. Use docs/plans for work spanning sessions.
6. Report executed checks and limitations. Do not weaken tests or provenance to get green output.

## Invariants

- Libraries, fonts, imagery, and basemap data are local runtime assets. Optional live transport uses a network relay only while enabled; never store live positions offline.
- Range/archive responses stay outside the service-worker shell cache.
- Existing verified offline downloads survive unsuccessful replacements.
- No application copies, binaries, or temporary assets in repository root.
- Data producers depend on shared contracts, not web implementation.
- Keep source provenance and licensing intact. Legacy geometry does not have reliable upstream identity.
- Isolate simultaneous work in separate worktrees/ports; keep secrets out of Git and artifacts.
