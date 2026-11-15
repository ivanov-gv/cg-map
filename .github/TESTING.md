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

## Test-run mode

Every job has a `-test-run` twin with the same steps, selected by a `test_run` input. The exceptions are the `switch`
jobs, `select` (which passes the test_run flag through to downstream jobs), `Check job times`, and the check for test
runs below. The twins use the `test-run` environment, whose variables send everything to a test destination. Local runs
always use it, and manual runs default to it. `CI gate` and `approval` have no twin, and neither does the Pages deploy,
because Pages can only publish to this repository: a test run stops at the assembled site.

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
use `environment: test-run`. The two exceptions are the approval gate (`ci-approval`, which waits for manual approval)
and the Pages deploy (`github-pages`, which publishes to the repository site).

## Locally with act

Needs Docker and `gh extension install nektos/gh-act`. The image is private, so a new machine needs
`gh auth token | docker login ghcr.io --username <you> --password-stdin` once, with `read:packages`. Every target runs
on [the pinned browser image](../docs/decisions/0007-browser-test-image.md), which it pulls if needed, so browser jobs
run the same tools on any machine as on GitHub. A machine with a GPU renders on it, and GitHub's runners use software
rendering. `ACT_JOBS` sets how many jobs of each workflow run at once.

```sh
make test-ci-docs                       # one workflow
make test-ci-pr-checks                  # everything CI runs
make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA> # needs a dev package from main
make test-cd-browser-image VERSION=1.56.1-r2 COMMIT=<full SHA on main> # see below
make test-all-workflows ACT="gh act -n" # dry run of every target
```

`test-cd-browser-image` promotes an image from the test registry, tagged with a commit on `main`, so push one first with
`docker tag <image> ttl.sh/ivanov-gv-cg-map/browser-ci:<SHA>`, then `docker push`. Use a new revision on each try,
because a version never changes there either.

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
gh workflow run cd-map-core.yml --ref <branch> -f test_run=true -f version=0.2.0 -f commit=<full SHA>
gh workflow run cd-browser-image.yml --ref <branch> -f test_run=true -f version=1.56.1-r2 -f commit=<full SHA>
```

`ci-workflows` fails a PR that changes `.github/**`, except Markdown, or the planner, until a successful test run of
`ci-pr-checks` exists for its latest commit, a `cd-map-core` test run when that workflow or a composite action changed,
and a `cd-browser-image` one when that workflow or its actions changed. A workflow not yet on `main` cannot be
dispatched, so it is exempt. After those runs pass, re-run the failed check. CI cannot see local runs, so record yours
in the PR template.

After merging `ci-pr-checks.yml` or `ci-nightly.yml`, they cannot be dispatched until the merge lands on `main`. Test
them locally first with `make test-ci-pr-checks` and `make test-ci-nightly`; the test-run-evidence check exempts
workflows not yet on `main` automatically.

## Through a real PR

`ci-pr-checks` starts on every PR, waits for approval on the `ci-approval` environment, and then selects pipelines from
the diff. A push to main triggers `ci-publish` independently — it builds and pushes images and packages (it runs no
checks because the PR run already tested the content). `ci-publish` has its own test-run switch and planner (shared with
`ci-pr-checks` through a composite action at `.github/actions/plan`). A push to main also triggers `ci-dev-pages`
independently — it builds the dev site from source and uploads the artifact. The nightly run of `ci-nightly` checks
everything by calling `ci-pr-checks` with `run_all: true`. To see what a branch would select:

```sh
make ci-plan BASE=origin/main
```

Pushing images, deploying Pages and publishing dev packages run only from `main`, so only a real merge proves them.
