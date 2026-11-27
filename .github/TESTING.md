# Testing workflows

## Prove CI/CD before main

**No CI/CD change reaches `main` unproved.** This covers `.github/**` (workflows, composite actions) and the platform
tooling they run (`platform/tools/ci-plan.mjs`, `platform/tools/workflow-test-runs.mjs` and the like). Before merging:

1. **Name every path the change touches:** each changed job, step, condition, input, fallback and error branch.
2. **Prove each one on the task branch** with the options below, cheapest first, and **link the log line that shows it
   ran** in the PR. A green `CI gate` is not proof when it skipped the changed job, never reached the new step, or took
   another branch of the condition.
3. **If a path cannot be reached before merge, make it reachable** (an input, a variable, a test-run target). "Not
   testable before merge" is never an accepted outcome.

Options to prove a change before it reaches `main`:

| Option                    | Command                                                                                                                                                                                         | Proves                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Lint                      | `make lint-workflows` (pinned actionlint and shellcheck)                                                                                                                                        | Syntax, expressions, shell                                                                                                |
| Platform tests            | `make verify PKG=platform`, with a failure proof for each new assertion                                                                                                                         | Structure, selection logic, inputs                                                                                        |
| act dry run               | `make test-<workflow> ACT="$ACT -n"`                                                                                                                                                            | That the workflow parses; never a test                                                                                    |
| act test run              | `make test-<workflow>`                                                                                                                                                                          | Steps and their order, locally, in `test_run` mode                                                                        |
| PR gate test runs         | Push the branch; `CI gate` calls changed `ci-*` workflows and dispatches changed `cd-*` ones                                                                                                    | The PR's own workflows on GitHub, in `test_run` mode                                                                      |
| Branch dispatch           | `gh workflow run <file> --ref <branch> -f test_run=true …`, with inputs that reach the path                                                                                                     | Any path the gate does not reach: fallbacks, other commits or versions, error branches                                    |
| Proof branch              | A throwaway branch on top of the PR with a small change that selects the path, then `gh workflow run ci-pr-checks.yml --ref <proof branch> -f test_run=false -f run_all=false`; delete it after | Paths the PR's own diff does not select: an in-place workflow call without a folder job, a publish job, every CD dispatch |
| Dry-run publishing        | The `test_run` dispatch of a publishing workflow, whose test-run environment publishes with `--dry-run`                                                                                         | Publishing steps without a real release                                                                                   |
| Fix on the failing branch | Cherry-pick the fix onto the branch that showed the bug and read that branch's run                                                                                                              | That the fix fixes the failure that was seen                                                                              |

A fix to a bug found after a merge follows the same rule: its own PR must run the path it fixes before it merges.

**A PR merges only when its tests pass on GitHub**: its PR run (`CI gate`). A change to `.github/**` makes the gate call
every changed `ci-*` workflow in `test_run` mode and dispatch/wait for every changed `cd-*` workflow, using a real
commit and a collision-free test version. There is no evidence job to re-run: the gate fails if a proved workflow fails.
The pre-push hook selects its checks from the pushed refs with the same planner: `make verify PKG=<project>` per
distinct local project, `make check-go` for backend, and `make check` plus `make check-go` when Go is available if the
diff cannot be read or the planner fails. It runs no browser suites; `make check` remains the full local run. Browser
suites (`make -C apps/<x> e2e`, `make test-e2e`) and `act` runs are optional, for iterating, except
`make test-cd-dev-pages` when changing ci-publish or cd-dev-pages ([Pages recipe](#pages-path-recipe)). A change to
`.github/**` also needs `make lint-workflows` locally. After a fix, push again and let the gate prove the new commit.

Running a workflow is the only way to know it works, so every workflow keeps three ways to run it: locally under `act`
(`test_run`), a manual `workflow_dispatch` with `test_run`, and the default production run. A local dry run is a parse
check only. The automatic GitHub test runs in `CI gate` are what proves a workflow; local `act` runs are optional,
except `make test-cd-dev-pages` when changing ci-publish or cd-dev-pages ([Pages recipe](#pages-path-recipe)). Pipeline
structure and reasoning: [ADR 0005](../docs/decisions/0005-packages-releases-and-dev-pages.md),
[ADR 0006](../docs/decisions/0006-ci-time-limits-and-tests-before-merge.md), whose local-run requirement is changed by
[ADR 0032](../docs/decisions/0032-tests-pass-on-github-and-earn-their-cost.md),
[ADR 0033](../docs/decisions/0033-automatic-workflow-test-runs.md), [ADR 0017](../docs/decisions/0017-ci-cd-model.md)
and [release](../docs/runbooks/release.md).

## Order

Lint and the PR gate's GitHub test runs are required; local runs are optional for iterating, except
`make test-cd-dev-pages` when changing ci-publish or cd-dev-pages ([Pages recipe](#pages-path-recipe)). Run them in this
order, stopping at the first failure:

1. **Lint (required):** `make lint-workflows` runs actionlint locally, catching syntax errors before any run.
2. **Local dry run (optional):** `make test-<workflow> ACT="$ACT -n"` checks that the workflow parses without executing
   steps. It is never a test run.
3. **Local test run (optional, except Pages):** `make test-<workflow>` runs the workflow under `act`, checking logic and
   step ordering.
4. **GitHub test runs (required, automatic):** push the branch and read `CI gate`. It calls changed `ci-*` workflows
   with `test_run: true` and dispatches changed `cd-*` workflows with `test_run=true`, then waits for their conclusions.
   For a workflow that cannot be proved automatically, run the manual command in [On GitHub](#on-github) and re-run the
   gate.

A workflow can be dispatched on a branch once GitHub has registered it, that is, once it has run at least once (for
example from a pull request). Dispatch it by numeric id when the file name returns 404. A schedule- or dispatch-only
workflow that has never run (such as a new ci-nightly) cannot be dispatched until it lands on main. Dispatch the
workflows it calls, with the same inputs, instead.

## Time limits

A job aims for 5 minutes and stops at 7: every job sets `timeout-minutes` to 7 or less, and `platform/tests/workflows`
checks that. `Check job times` warns about any job over 5 minutes. When a job gets close, split it into more jobs, as
`ci-apps-web` and `ci-apps-editor` split their browser tests into the shards counted in each app's `browser-jobs.json`;
do not raise the limit. The exception is `cd-test-runs` in `ci-workflows`: it occupies a runner while it polls, but
avoids repeating the browser-image build and waits up to 30 minutes for it.

The whole PR run also has a time budget: from approval to `CI gate`, the aim is 5 minutes and the limit is 7. The
`CI gate` job runs `platform/tools/run-budget.mjs` after the existing checks: it fetches the run attempt metadata (from
`GET repos/$GH_REPO/actions/runs/$RUN_ID/attempts/$RUN_ATTEMPT`) for `run_started_at`, then fetches every page of the
jobs JSON with `per_page=100` and `--paginate --slurp`, so the tool sees all jobs in one array of API responses. The
effective start is the later of the approval job's completion and the attempt's `run_started_at` — this correctly
handles reruns, where the attempt starts after the original approval. If `run_started_at` is unreadable, it falls back
to the approval time; if neither is available, it uses the earliest job start. Non-PR events (schedule, manual dispatch)
are exempt, as are PRs that wait for CD test runs: an external browser-image build can outlast seven minutes, and
`cd-test-runs` has its own 30-minute limit. The `CI gate` summary names the wait that grants the exemption. Unreadable
timings only warn — they do not fail the gate.

The budget includes time spent waiting for runners. The Free plan runs at most 20 jobs at once, so a run's job count
drives its wall time as much as its slowest job: PR #358 ran 102 jobs and took 565 s while no job took more than 200 s.
Keep selections narrow rather than raising the limit; for example, a root `Makefile` change selects only the folders
whose CI calls it, without browser areas (Bug #383), and the same PR then ran 32 jobs in 206 s.

## Test-run mode

Every job has a `-test-run` twin with the same steps, selected by a `test_run` input. The exceptions are the `switch`
jobs, `select` (which only passes the planner's image matrix on), `run` in ci-nightly (which only calls ci-pr-checks),
`pages-cleanup` in ci-publish (which only runs in production), `Check job times`, `CI gate`, `approval`, the Pages
deploy in cd-dev-pages (because Pages can only publish to this repository: a test run stops after the find job),
`cd-test-runs` in ci-workflows (a test run must not dispatch another test run), the `test-ci-*` jobs in ci-pr-checks
(each is already a test-run call), and the folder jobs in ci-pr-checks (`docs`, `workflows`, `platform`, `contracts`,
`browser-image`, `data`, `backend`, `transit-relay`, `tests`, `map-core`, `apps-web`, `apps-editor`, `apps-core-demo`)
which call each folder's workflow with `test_run` passed through. The `find` job in cd-dev-pages gates on CI conclusion
in its `if:` — no separate gate job. The twins use the `test-run` environment, whose variables send everything to a test
destination. Local runs always use it, and manual runs default to it.

The `dev` and `test-run` environments define these variables:

| Variable                      | `dev`                      | `test-run`                |
| ----------------------------- | -------------------------- | ------------------------- |
| `IMAGE_REPOSITORY`            | `ghcr.io/ivanov-gv/cg-map` | `ttl.sh/ivanov-gv-cg-map` |
| `WEB_ARTIFACT_NAME`           | `web-artifact`             | `web-artifact-test-run`   |
| `WEB_ARTIFACT_RETENTION_DAYS` | `30`                       | `1`                       |
| `PACKAGE_PUBLISH_FLAGS`       | unset                      | `--dry-run`               |
| `DEV_PAGES_PACKAGE`           | `cg-map/dev-pages`         | `cg-map/web`              |
| `DEV_PAGES_VERSIONS_TO_KEEP`  | `10`                       | `100000`                  |

The `test-run` values list an existing package and delete nothing.

`package-release` needs only `IMAGE_REPOSITORY`, with the same value as `dev`, for `cd-browser-image`.

A test run really pushes images, to a temporary public registry, and really runs npm publish as a dry run, after
checking registry auth with `npm whoami` so a missing token fails the test run as a real publish would. Every published
image gets a moving `:dev` tag next to `:<commit>` and an `org.opencontainers.image.revision` label carrying that
commit, in both environments. The browser image gets the same label through
`make -C platform browser-image REVISION=<commit>`. `ci-publish` keeps the newest dev-pages versions, so cleanup never
deletes the version `:dev` points at.

A new moving tag exists only after its first publish. Pipelines that read it, such as the CD test runs, fail until then,
and an artifact published only when its inputs change (the browser image) may not get it for weeks. After adding one,
run `gh workflow run ci-publish.yml --ref main -f test_run=false -f run_all=true` once and check the tag.

Production jobs reference the `dev` environment only when they read its variables or secrets (via `${{ vars.* }}` or
`${{ secrets.* }}` anywhere in an expression). Jobs that read nothing carry no environment at all. Test-run twins
reference `test-run`; the deployment rule below gives the mapping form both must use. The exception is the approval gate
(`ci-approval`, which passes automatically until the owner adds required reviewers). The Pages deploy in `cd-dev-pages`
references `github-pages` and has no test-run twin, but it is a CD workflow, not CI.

At most one job per run records a deployment; every other environment-bearing job uses the mapping form
`environment: {name: <env>, deployment: false}` and still reads that environment's secrets and variables. The choices
are: a CD release is recorded by the last job that changes its target; CI records none, including jobs that publish dev
artifacts; `ci-approval` records none, because it is a gate; every test-run twin records none, because a test run is not
a release. In `cd-dev-pages`, `find` reads `dev` without a deployment and `deploy` is the one deploying job, on
`github-pages`. Platform tests enforce the rule; see
[ADR 0034](../docs/decisions/0034-one-deployment-per-workflow-run.md). Protection rules still apply to every job that
names an environment, and a deployment shows only its chosen job's status.

## Locally with act

Needs Docker and act built from [nektos/act#6243](https://github.com/nektos/act/pull/6243). Workflows use
`environment.deployment`, which released act 0.2.98 rejects. Use this build until that pull request is merged and
released, then go back to the released act (or `gh act`) and drop the version check. Install it once; `go install`
cannot fetch a pull request's commit by itself, so check it out first:

```sh
git clone --filter=blob:none https://github.com/nektos/act "$HOME/.cache/cg-map/act-src"
git -C "$HOME/.cache/cg-map/act-src" fetch origin pull/6243/head
git -C "$HOME/.cache/cg-map/act-src" checkout 0f761c049dc3ef82fb686a4af7b917d9f3ef831d
(cd "$HOME/.cache/cg-map/act-src" && go install -ldflags "-X main.version=0.2.98-pr6243-0f761c0" .)
```

That puts `act` in `$(go env GOPATH)/bin`, and `make` uses it (`ACT ?= act`). `make` checks that `act --version` names
the commit and refuses any other build. The image is private, so a new machine needs
`gh auth token | docker login ghcr.io --username <you> --password-stdin` once, with `read:packages`. Every target runs
on [the pinned browser image](../docs/decisions/0007-browser-test-image.md), which it pulls if needed, so browser jobs
run the same tools on any machine as on GitHub. A machine with a GPU renders on it, and GitHub's runners use software
rendering. `ACT_JOBS` sets how many jobs of each workflow run at once.

```sh
make test-ci-docs                       # one workflow
make test-ci-pr-checks                  # every PR check
make test-cd-map-core VERSION=0.2.0 COMMIT=<full SHA> # needs a dev package from main
make test-cd-map-data VERSION=0.1.0 COMMIT=<full SHA> # needs a dev package from main
make test-cd-map-contracts VERSION=0.1.0 COMMIT=<full SHA> # needs a dev package from main
make test-cd-dev-pages COMMIT=<full SHA on main> # needs a ci-publish dev-pages image; see below
make test-cd-browser-image VERSION=1.56.1-r2 COMMIT=<full SHA on main> # see below
make test-all-workflows ACT="$ACT -n" # dry run of every target
```

`test-cd-browser-image` promotes an image from the test registry, tagged with a commit on `main`, so push one first with
`docker tag <image> ttl.sh/ivanov-gv-cg-map/browser-ci:<SHA>`, then `docker push`. Use a new revision on each try,
because a version never changes there either.

`test-cd-dev-pages` requires `COMMIT=` and generates a dynamic event payload simulating the `workflow_run` trigger from
ci-publish: the find step pulls `$IMAGE_REPOSITORY/dev-pages:<commit>` and extracts the site. CD only runs for a
successful push build on main — never for a CI test run, a dispatched CI run, a failed or cancelled run, or any branch
but main. Run it with `make test-cd-dev-pages COMMIT=<full SHA>`.

`test-cd-dev-pages-dispatch` simulates a manual dispatch via `workflow_dispatch`. Pass a commit on `main` that has a
`dev-pages:<commit>` image. Read the `org.opencontainers.image.revision` label of `dev-pages:dev` with
`docker buildx imagetools inspect --format '{{json .Image}}' ghcr.io/ivanov-gv/cg-map/dev-pages:dev` (use the
`linux/amd64` entry when the result is an OCI index), then confirm the per-commit image with
`docker manifest inspect ghcr.io/ivanov-gv/cg-map/dev-pages:<full SHA>`. A successful `ci-publish` run is not a
substitute for that check. Run it with `make test-cd-dev-pages-dispatch COMMIT=<full SHA>`.

Under `act`, the image pull needs a real token and a real `ci-publish` run, so both paths pull from an actual CI run.
Under `act`, `IMAGE_REPOSITORY` is `ttl.sh/ivanov-gv-cg-map` (from `var.env`), so the test run of `ci-publish` must have
pushed the image first.

A dry run only checks that a workflow parses, so it does not count as a test or satisfy the required GitHub test run.
Once one job of a matrix fails, `act` reports the rest of that matrix as failed even when all their steps pass, so read
the steps of the first failure.

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
JSON parsing and creates a phantom failing job. `ci-apps-web.yml` and `ci-apps-editor.yml` use
`fromJSON(needs.verify.outputs.browser_matrix || '{"include":[]}')` so `act` can always parse the matrix. Each app
always supplies a matrix, so its browser jobs need no condition to skip an empty one.

## On GitHub

A workflow can be dispatched only once it exists on `main`. After that, dispatching runs your branch's version:

```sh
gh workflow run ci-pr-checks.yml --ref <branch> -f test_run=true -f run_all=true
gh workflow run ci-publish.yml --ref <branch> -f test_run=true
gh workflow run ci-publish.yml --ref <branch> -f test_run=true -f commit=<full SHA>
gh workflow run cd-map-core.yml --ref <branch> -f test_run=true -f version=0.2.0 -f commit=<full SHA>
gh workflow run cd-map-data.yml --ref <branch> -f test_run=true -f version=0.1.0 -f commit=<full SHA>
gh workflow run cd-map-contracts.yml --ref <branch> -f test_run=true -f version=0.1.0 -f commit=<full SHA>
gh workflow run cd-dev-pages.yml --ref <branch> -f test_run=true -f commit=<full SHA on main>
gh workflow run cd-browser-image.yml --ref <branch> -f test_run=true -f version=1.56.1-r2 -f commit=<full SHA>
```

The gate's planner selects the workflows a change touches and the gate proves them in the same PR run:

- Every changed callable `ci-*` workflow is proved by a `uses:` call with `test_run: true`. When its folder is selected
  by the diff, the regular folder call passes `test_run` instead of a second call running: the planner's
  `ci_in_place_test_runs` output drives that and keeps the workflow out of `ci_test_runs`. Workflows without a folder
  call, such as `ci-publish`, still get a separate `(test run) …` call. Both separate browser calls pass `smoke: true`
  so each builds one shard from its own job count, with the default tagged phone tests. These calls prove the workflow's
  jobs and steps, not whole suites. The regular browser calls pass no `smoke`, so a PR, the nightly run and a full
  dispatch run use each app-owned count: every shard runs for a web or editor change. The planner emits no browser
  matrix. The counts live in [web](../apps/web/browser-jobs.json) and [editor](../apps/editor/browser-jobs.json), with
  the proof rules in [apps/web/AGENTS.md](../apps/web/AGENTS.md) and [apps/editor/AGENTS.md](../apps/editor/AGENTS.md),
  and the reason in [ADR 0041](../docs/decisions/0041-app-owned-browser-shards.md). The `phone_tests` input applies only
  to `ci-apps-editor`, whose nightly runs every phone test; web runs only tagged phone tests in every run. An in-place
  `ci-workflows` call with no changed CD workflows still runs `cd-test-runs` with the empty list, whose script reports
  that no CD workflows need a test run. A shared action is proved by a workflow that really executes it.
- The regular PR run still dispatches changed CD workflows to `ci-workflows` even when that call runs in place in
  test-run mode. Only a test run of `ci-pr-checks` suppresses dispatch, so a dispatched test run cannot dispatch another
  test run.
- Every changed `cd-*` workflow is dispatched by `ci-workflows` with `test_run=true`, the head commit, and a unique test
  `VERSION` (or `test_id` for cd-dev-pages). The job reuses an existing successful test run of the head commit when one
  exists; otherwise it resolves the dev tag once in the registry and dispatches and waits for the real conclusion.
  Packages use `@ivanov-gv/<pkg>@dev` (`0.0.0-dev.<commit>`); images use `<repository>/<name>:dev` and read its
  `org.opencontainers.image.revision` label with `docker buildx imagetools inspect --format '{{json .Image}}'` (the
  `linux/amd64` entry for an OCI index), without pulling the moving tag. The job logs
  `<workflow>: dev tag resolves to <commit>` and dispatches the CD workflow with that commit; the image pull uses the
  commit tag. A missing tag or malformed version is an error naming the artifact; `ci-publish` on main publishes dev
  tags. A `ci-publish` conclusion is not a filter: a run can fail after another of its jobs published an artifact.
- A workflow not yet registered on `main`, or one whose `main` version lacks `workflow_dispatch`, `test_run` and
  `commit`, cannot be dispatched and is exempt with a reason in the job summary. `ci-pr-checks.yml` and `ci-nightly.yml`
  are always manual exceptions: a reusable call to either would form a cycle. Dispatch them with the first command below
  before merging a change to either.

A test run really publishes to temporary destinations; `act -n` only parses and proves nothing. CI cannot see local
runs; link any manual GitHub runs in the PR template and note local runs as context only.

`make test-ci-pr-checks`, `make test-ci-nightly`, `make test-ci-publish`, and `make test-cd-dev-pages COMMIT=<full SHA>`
remain optional local ways to iterate.

## Through a real PR

`ci-pr-checks` starts on every PR. The `ci-approval` environment gate passes automatically until the owner adds required
reviewers; adding a reviewer later needs no workflow change. Then the run selects pipelines from the diff. For a pull
request, the plan base is the merge base with the current base branch (`origin/<base_ref>`, fetched before
`git merge-base`), so merging the base branch into the PR does not add the base branch's own changes to the plan. Push
and `workflow_dispatch` runs keep their existing bases (`github.event.before` or `origin/main`). If the base cannot be
resolved or diffed, the planner selects everything and reports a visible reason. A push to main triggers `ci-publish`
independently — it builds and pushes images, packages, and the dev site image (it runs no checks because the PR run
already tested the content). `ci-publish` has its own test-run switch and planner (shared with `ci-pr-checks` through a
composite action at `.github/actions/plan`). The `pages` job in `ci-publish` builds the dev site from source and pushes
`$IMAGE_REPOSITORY/dev-pages:<sha>`. When `ci-publish` completes successfully on `main`, `cd-dev-pages` is triggered via
`workflow_run` — it pulls the image by commit SHA, extracts the site, and deploys it to GitHub Pages. `ci-nightly`
checks everything by calling `ci-pr-checks` with `run_all: true`; its nightly schedule is paused (issue #319), so it
runs only when dispatched until the cron is uncommented. To see what a branch would select:

```sh
make ci-plan BASE=origin/main
```

Pushing images, deploying Pages and publishing dev packages run only from `main`: a test run proves registry auth, but
only a real merge proves write access and the publish.

## Workflows must be testable and tested on GitHub before release

If a path cannot be tested yet, make it testable (inputs, `workflow_dispatch`, environment variables with test-run
values). Keep all three ways to run a workflow available — locally under `act` (`test_run`), a manual
`workflow_dispatch` with `test_run`, and the default production run — but the PR gate's GitHub test runs of every
workflow touched, plus what `make ci-plan BASE=origin/main` selects, are what gates the merge. A local dry run is a
parse check only. Local `act` runs are optional, except `make test-cd-dev-pages` when changing ci-publish or
cd-dev-pages ([Pages recipe](#pages-path-recipe)).

### Pages path recipe

Test the full Pages CI/CD path on GitHub before merging a change to `ci-publish`, or `cd-dev-pages`:

1. Dispatch `ci-publish` on the branch with `test_run=true` and `commit=<main SHA>` to push a test-run image.
2. Dispatch `cd-dev-pages` on the branch with `test_run=true` and `commit=<main SHA>` for the dispatch path.
3. `make test-cd-dev-pages COMMIT=<main SHA>` — **REQUIRED local exception** for the `workflow_run` path, which GitHub
   cannot exercise before merge. `make test-cd-dev-pages-dispatch` (dispatch path, same `COMMIT`) remains an optional
   local `act` run for iterating.
4. After the stack lands, the first push to `main` runs the workflow_run path end to end.
