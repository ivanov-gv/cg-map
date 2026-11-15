# Testing workflows

**No merge until local tests pass.** A PR that changes `.github/**` does not merge until every workflow it touches has
passed under `act`. After a fix, rerun the workflow you changed and what `make ci-plan` selects. A run on GitHub does
not replace this. If a local run cannot pass, fix the local setup. Do not report it as a limit and merge anyway. Any
other PR needs its owning project's checks, and browser tests where it changes a browser project.

Running a workflow is the only way to know it works, so a change to `.github/**` must run in test-run mode locally and
on GitHub. Pipeline structure and reasoning: [ADR 0005](../docs/decisions/0005-packages-releases-and-dev-pages.md),
[ADR 0006](../docs/decisions/0006-ci-time-limits-and-tests-before-merge.md),
[ADR 0017](../docs/decisions/0017-ci-cd-model.md) and [release](../docs/runbooks/release.md).

## Order

Test workflows in this order, stopping at the first failure:

1. **Lint:** `make lint-workflows` runs actionlint locally, catching syntax errors before any run.
2. **Local run:** `make test-<workflow>` runs the workflow under `act`, checking logic and step ordering.
3. **GitHub test run:** dispatch the workflow with `workflow_dispatch` on GitHub, verifying environment settings,
   variables, and secrets. A workflow not yet on `main` cannot be dispatched; see the [On GitHub](#on-github) section
   for the exemption.

## Time limits

A job aims for 5 minutes and stops at 7: every job sets `timeout-minutes` to 7 or less, and `platform/tests/workflows`
checks that. `Check job times` warns about any job over 5 minutes. When a job gets close, split it into more jobs, as
`ci-apps-editor` splits its browser tests; do not raise the limit.

The whole PR run also has a time budget: from approval to `CI gate`, the aim is 5 minutes and the limit is 7. The
`CI gate` job runs `platform/tools/run-budget.mjs` after the existing checks: it fetches the run attempt metadata (from
`GET repos/$GH_REPO/actions/runs/$RUN_ID/attempts/$RUN_ATTEMPT`) for `run_started_at`, then fetches the jobs JSON. The
effective start is the later of the approval job's completion and the attempt's `run_started_at` — this correctly
handles reruns, where the attempt starts after the original approval. If `run_started_at` is unreadable, it falls back
to the approval time; if neither is available, it uses the earliest job start. Non-PR events (schedule, manual dispatch)
are exempt. Unreadable timings only warn — they do not fail the gate.

## Test-run mode

Every job has a `-test-run` twin with the same steps, selected by a `test_run` input. The exceptions are the `switch`
jobs, `select` (which only passes the planner's image matrix on), `run` in ci-nightly (which only calls ci-pr-checks),
`Check job times`, the check for test runs below, `CI gate`, `approval`, the Pages deploy in cd-dev-pages (because Pages
can only publish to this repository: a test run stops after the find job), and the folder jobs in ci-pr-checks (`docs`,
`workflows`, `platform`, `contracts`, `browser-image`, `data`, `backend`, `transit-relay`, `tests`, `map-core`,
`apps-web`, `apps-editor`, `apps-core-demo`) which call each folder's workflow with `test_run` passed through. The twins
use the `test-run` environment, whose variables send everything to a test destination. Local runs always use it, and
manual runs default to it.

The `dev` and `test-run` environments define these variables:

| Variable                      | `dev`                      | `test-run`                |
| ----------------------------- | -------------------------- | ------------------------- |
| `IMAGE_REPOSITORY`            | `ghcr.io/ivanov-gv/cg-map` | `ttl.sh/ivanov-gv-cg-map` |
| `WEB_ARTIFACT_NAME`           | `web-artifact`             | `web-artifact-test-run`   |
| `WEB_ARTIFACT_RETENTION_DAYS` | `30`                       | `1`                       |
| `PACKAGE_PUBLISH_FLAGS`       | unset                      | `--dry-run`               |

`package-release` needs only `IMAGE_REPOSITORY`, with the same value as `dev`, for `cd-browser-image`.

A test run really pushes images, to a temporary public registry, and really runs npm publish, as a dry run.

Production jobs use `environment: dev` only when they read its variables or secrets (via `${{ vars.* }}` or
`${{ secrets.* }}` anywhere in an expression). Jobs that read nothing carry no environment at all. Test-run twins always
use `environment: test-run`. The exception is the approval gate (`ci-approval`, which passes automatically until the
owner adds required reviewers). The Pages deploy in `cd-dev-pages` uses `github-pages` and has no test-run twin, but it
is a CD workflow, not CI.

## Locally with act

Needs Docker and `gh extension install nektos/gh-act`. The image is private, so a new machine needs
`gh auth token | docker login ghcr.io --username <you> --password-stdin` once, with `read:packages`. Every target runs
on [the pinned browser image](../docs/decisions/0007-browser-test-image.md), which it pulls if needed, so browser jobs
run the same tools on any machine as on GitHub. A machine with a GPU renders on it, and GitHub's runners use software
rendering. `ACT_JOBS` sets how many jobs of each workflow run at once.

```sh
make test-ci-docs                       # one workflow
make test-ci-pr-checks                  # every PR check
make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA> # needs a dev package from main
make test-cd-dev-pages COMMIT=<full SHA on main> # needs a ci-dev-pages artifact; see below
make test-cd-browser-image VERSION=1.56.1-r2 COMMIT=<full SHA on main> # see below
make test-all-workflows ACT="gh act -n" # dry run of every target
```

`test-cd-browser-image` promotes an image from the test registry, tagged with a commit on `main`, so push one first with
`docker tag <image> ttl.sh/ivanov-gv-cg-map/browser-ci:<SHA>`, then `docker push`. Use a new revision on each try,
because a version never changes there either.

`test-cd-dev-pages` needs a commit on `main` that has a successful `ci-dev-pages` run with a `github-pages` artifact.
Find one with
`gh run list --workflow ci-dev-pages.yml --branch main --status success --json headSha --jq '.[0].headSha'`. Under
`act`, the GitHub run/artifact APIs need a real token and a real `ci-dev-pages` run, so the target passes `COMMIT=` a
recent main SHA the way `test-cd-map-core` passes its inputs.

A dry run only checks that a workflow parses, so it does not count as a test. Once one job of a matrix fails, `act`
reports the rest of that matrix as failed even when all their steps pass, so read the steps of the first failure.

`act` has limits that shape these workflows. It ignores `timeout-minutes`, so only a run on GitHub proves a job's time.
Its artifact server rejects `upload-artifact@v6` and `upload-pages-artifact@v5`, so they stay at `@v5` and `@v4`. Its
matrix jobs run in parallel and would share a port on the host network, so targets use `--network bridge`. Every target
needs `.github/act/secret.env`, which Git ignores, because installing dependencies reads GitHub Packages: see
`secret.env.example` beside it.

act targets mount the git common directory so they work from worktrees as well as the main clone. Set the clone's
`origin` to the GitHub URL, because `act` takes the repository name from it. Run workflows one at a time on a machine
short of disk or CPU: `ci-apps-web` alone can use several gigabytes. If `make test-ci-pr-checks` ends with
`context deadline exceeded` while `act` removes containers, the run stopped before its browser jobs and gate, so it does
not count: check `docker ps`, then run it again with a lower `ACT_JOBS`.

**Matrix in called workflows:** `act` evaluates `matrix: ${{ fromJSON(needs.*.outputs.*) }}` before `needs` outputs
exist when the workflow is triggered by `workflow_call` (nektos/act#2313, #927), producing a literal string that fails
JSON parsing and creates a phantom failing job. Browser workflows (`ci-apps-web`, `ci-apps-editor`) work around this
with a fallback — `fromJSON(needs.verify.outputs.browser_matrix || '{"include":[]}')` — so act can always parse the
matrix. The job's `if` guard still skips execution when the matrix is empty, so GitHub behavior is unchanged.

## On GitHub

A workflow can be dispatched only once it exists on `main`. After that, dispatching runs your branch's version:

```sh
gh workflow run ci-pr-checks.yml --ref <branch> -f test_run=true -f run_all=true
gh workflow run ci-publish.yml --ref <branch> -f test_run=true
gh workflow run ci-dev-pages.yml --ref <branch> -f test_run=true
gh workflow run cd-map-core.yml --ref <branch> -f test_run=true -f version=0.2.0 -f commit=<full SHA>
gh workflow run cd-dev-pages.yml --ref <branch> -f test_run=true -f commit=<full SHA>
gh workflow run cd-browser-image.yml --ref <branch> -f test_run=true -f version=1.56.1-r2 -f commit=<full SHA>
```

`ci-workflows` fails a PR that changes `.github/**`, except Markdown, or the planner, until a successful test run of
`ci-pr-checks` exists for its latest commit, a `cd-map-core` test run when that workflow or a composite action changed,
a `cd-browser-image` one when that workflow or its actions changed, a `ci-publish` test run when `ci-publish.yml` or the
publish-related actions (`plan`, `publish-image`, `publish-dev-package`, `publish-browser-image`, `setup-web`,
`run-check`) changed, a `ci-dev-pages` test run when `ci-dev-pages.yml` or the actions it uses (`setup-web`,
`install-dependencies`, `test_run`) changed, and a `cd-dev-pages` test run when `cd-dev-pages.yml`,
`find-pages-artifact` or `test_run` changed. A workflow not yet on `main` cannot be dispatched, so it is exempt. The
same exemption applies when a workflow on `main` lacks `workflow_dispatch` and cannot be dispatched. After those runs
pass, re-run the failed check. CI cannot see local runs, so record yours in the PR template.

`ci-pr-checks.yml`, `ci-nightly.yml`, `ci-publish.yml` and `cd-dev-pages.yml` cannot be dispatched until they land on
main; until then, test them locally with `make test-ci-pr-checks`, `make test-ci-nightly`, `make test-ci-publish`, and
`make test-cd-dev-pages COMMIT=<full SHA>`. The test-run-evidence check exempts workflows not yet on `main`
automatically.

## Through a real PR

`ci-pr-checks` starts on every PR. The `ci-approval` environment gate passes automatically until the owner adds required
reviewers; adding a reviewer later needs no workflow change. Then the run selects pipelines from the diff. A push to
main triggers `ci-publish` independently — it builds and pushes images and packages (it runs no checks because the PR
run already tested the content). `ci-publish` has its own test-run switch and planner (shared with `ci-pr-checks`
through a composite action at `.github/actions/plan`). A push to main also triggers `ci-dev-pages` independently — it
builds the dev site from source and uploads the artifact. A push to main also triggers `cd-dev-pages` independently — it
finds that artifact and deploys it to GitHub Pages. The nightly run of `ci-nightly` checks everything by calling
`ci-pr-checks` with `run_all: true`. To see what a branch would select:

```sh
make ci-plan BASE=origin/main
```

Pushing images, deploying Pages and publishing dev packages run only from `main`, so only a real merge proves them.
