# Task: monorepo CI, separate CD, and auto-merge

Status: in progress

## Goal and acceptance criteria

Treat each top-level component as a separate project with its own pipeline, run only what a change needs, make the
browser suite fast, separate CI from CD, and make `gh pr merge --auto --squash` wait for checks. Today GitHub's
auto-merge cannot wait, because `main` has no required checks.

Observable behavior:

| Change in the PR     | Today     | Target                                                        |
| -------------------- | --------- | ------------------------------------------------------------- |
| Markdown only        | 10-12m    | Under 1m, `ci-docs` only                                      |
| Go backend only      | About 30s | About 30s, `ci-backend` only                                  |
| Tooling or tests     | 10-12m    | Under 2m, unless it affects the web                           |
| One web browser area | 10-12m    | The time of that area's job, plus the web build               |
| Shared web or data   | 10-12m    | About 6m, full browser suite                                  |
| `.github/**`         | 10-12m    | Lint and platform tests, plus the two test runs in Decision 8 |

Only the "Today" column is measured. Confirm the targets in steps 1 and 4.

- One required check, `CI gate`, reports on every PR whatever changed. A failed, cancelled, or unplanned check fails it.
- `gh pr merge --auto --squash` waits for `CI gate`, and a failing PR cannot merge.
- A change the planner cannot classify runs everything.
- CI holds no deployment permissions and never uses the `github-pages` environment.
- CD deploys only an artifact that passed the full browser suite on `main`. It never checks out source or rebuilds.
- A change to `.github/**` cannot merge until its workflows have really run in test-run mode, locally and on GitHub.

Constraints and affected components: `.github/workflows`, `.github/actions`, `.github/pull_request_template.md`,
`platform/tools`, `platform/tests`, the root `Makefile`, `platform/Makefile`, and the docs listed in step 6. No app
behavior changes. Do not weaken or remove any test to save time.

## Current state

The baseline is run 41845205724, the merge of PR 9, on 2026-11-04. It replaces earlier measurements of a single browser
job; `web.yml` now already runs browser tests as four parallel area jobs.

| Job                 | Job time | Test time | Contents                                  |
| ------------------- | -------- | --------- | ----------------------------------------- |
| Build and verify    | 29s      | -         | `make check`, artifact upload             |
| Browser (places)    | 598s     | 553s      | `discover` 71s, `poi-visibility` 481s     |
| Browser (journeys)  | 305s     | 261s      | Desktop 155s, mobile 106s                 |
| Browser (interface) | 238s     | 195s      | Desktop 106s, mobile 89s                  |
| Browser (shell)     | 182s     | 104s      | `shell` and `updates`, both projects      |
| Deploy              | 11s      | -         | Runs on `main` after `Browser acceptance` |

- A full run takes 10-12 minutes, set by the slowest area. `poi-visibility.spec.mjs` is 43% of all browser test time.
- Run setup costs about a minute per browser job.
- In run 41843418732, installing Chromium with `--with-deps` took about 5m40s in the `interface` job, whose tests took
  3.4 minutes. Installation time is therefore not reliably small.
- Replaying the 29 commits on `main` through approximate rules gave: 5 docs-only, 6 needing no browser tests, 1 needing
  a single area, and 17 needing the full suite. The replay treats `style.css` and `index.html` as shared, and early
  commits were large restructures. `app.js` imports nearly every module and every browser test boots it.
- The `web-artifact` is 10.8 MB, the repository is public, and the `github-pages` environment has a branch policy.
- `web.yml` skips only Go-only changes, so a one-line docs PR runs the full browser suite and redeploys Pages.
- `concurrency` has `cancel-in-progress: false`, so superseded PR runs finish anyway.

## Pipeline tree

GitHub loads workflows only from the top of `.github/workflows/`, so a folder's workflow cannot live inside that folder.
Each folder workflow stays thin and calls `make verify PKG=<folder>`, leaving the logic with the owning component.

```text
CI: runs checks, builds the artifact, holds read-only permissions
ci-all.yml                   PR, push to main, nightly, manual (test_run, run_all)
├── switch                   chooses production or test-run jobs
├── plan | plan-test-run     platform/tools/ci-plan.mjs: diff → folders + browser areas
├── ci-docs.yml              all Markdown, repo checks, agent rules
├── ci-workflows.yml         actionlint, test-run evidence
├── ci-platform.yml          make verify PKG=platform
├── ci-contracts.yml         make verify PKG=packages/contracts
├── ci-data.yml              make verify PKG=data
├── ci-backend.yml           make -C services/backend check (Go only, no Node)
├── ci-transit-relay.yml     make verify PKG=services/transit-relay
├── ci-tests.yml             make verify PKG=tests
├── ci-apps-web.yml
│   ├── verify               make verify PKG=apps/web, uploads web-artifact
│   └── browser              matrix, needs verify; estimated job time
│       ├── shell            ~3m
│       ├── journeys         ~5m
│       ├── interface        ~4m
│       ├── discover         ~2m
│       ├── poi-desktop      ~5.5m
│       └── poi-mobile       ~4m
└── CI gate                  always reports; the only required check; has no twin

CD: reads a CI artifact, holds deployment permissions, never touches source
cd-pages.yml                 workflow_run of ci-all on main, manual (run_id, test_run)
├── switch                   chooses production or test-run jobs
├── prepare | prepare-test-run   find and check the artifact, copy it into this run as the Pages artifact
└── deploy | deploy-test-run     actions/deploy-pages | dummy that logs the expected result
```

Every job in the tree except `switch` and `CI gate` is a production and test-run pair, including each job inside the
folder workflows. All pairs share steps except `deploy`. Every workflow has a `workflow_dispatch` trigger with
`test_run`, and a `make` target for `act`.

## Decisions

These follow from reviews of options on 2026-11-04.

1. **Gate job instead of naming each check.** GitHub has no "all checks must pass" setting. A required check that never
   runs because of a workflow `paths` filter stays pending forever, while a job skipped by `if:` counts as passed. So
   one workflow always runs, plans the work, and ends with a gate job that always reports. The gate is a plain job in
   `ci-all.yml`, because jobs inside called workflows report under a `caller / called` name.
2. **One pipeline per folder.** Owner direction, replacing the earlier "coarse lanes" decision. `make check` takes only
   16s, so the folder split gains speed mainly by skipping whole folders. Its other value is structure: each component
   owns its checks. The components are not independent, so the planner carries the dependency table below.
3. **Planner script in the repo, not a third-party action.** `platform/tools/ci-plan.mjs` can be unit tested and run
   locally, reuses the component list in `verify.mjs`, and adds no dependency.
4. **Fail safe.** Anything unmatched, an empty diff, or a planner error selects every folder and browser area.
5. **Select browser tests by area, never by test.** Replaces "never select browser tests". A PR runs only the affected
   areas when a change maps cleanly to them; shared code runs every area. Area selection is expected to help rarely, so
   it comes after the split, reports its hit rate, and is removed if it rarely narrows a run.
6. **`main` always runs the full browser suite when the web is affected.** A wrong area mapping can turn `main` red but
   cannot reach users, as `docs/verification/testing.md` already requires.
7. **Keep a full run as the safety net.** Branches need not be up to date with `main` to merge, so two PRs can each pass
   and break together. A nightly full run on `main` catches this, along with folder or area mapping mistakes.
8. **Workflow changes are proven by running them.** Owner direction: running a workflow is the only way to know it is
   good. A `.github/**` change does not run every folder on its PR. Instead its author must run the changed workflows in
   test-run mode locally with `act` and on GitHub with `workflow_dispatch`. The GitHub run is enforced: `ci-workflows`
   fails until a successful test run exists for the PR's head commit. CI cannot see a local run, so the PR template
   records that one.
9. **CI and CD are separate workflows, joined only by an artifact.** See below.
10. **Every workflow follows the test-run model in the `cicd-general` and `cicd-github` skills.** See below.

### Test-run model

Owner direction: the skills' model applies as written, with twin jobs in `ci-*` workflows too.

- **Pairs:** each job has a `-test-run` twin with the same steps and `env:`, shared through YAML anchors. A `switch` job
  using `.github/actions/test_run` selects the pair. Steps never read `test_run`, and no step is skipped by mode.
- **Switch:** it outputs `true` for `inputs.test_run` or a local `act` run, and `false` otherwise. `test_run` defaults
  to `true` on manual runs, so a production dispatch is always a deliberate choice. Called workflows receive it as an
  input and also accept it directly when dispatched alone.
- **Outputs:** a twin that reads `needs.<job>.outputs` gets its own copy of `env:`, because an anchor would read the
  production job's output. This applies to jobs that read `plan` or `prepare` outputs.
- **Environments:** production CI jobs use a new `dev` environment and test-run twins a new `test-run` environment. CD
  uses `github-pages` and `test-run`. Each mode's differences are environment-scoped vars, never branches in steps.
- **Local runs:** `.github/act/var.env` and `.github/act/secret.env` supply test-run values, and are not committed with
  real secrets. Add `.github/act/` event payloads where needed.

| Var                           | Production     | Test-run                | Why                                                |
| ----------------------------- | -------------- | ----------------------- | -------------------------------------------------- |
| `WEB_ARTIFACT_NAME`           | `web-artifact` | `web-artifact-test-run` | A test artifact can never be picked up for release |
| `WEB_ARTIFACT_RETENTION_DAYS` | `30`           | `1`                     | The rollback window applies only to production     |
| `CI_SOURCE_EVENT`             | `push`         | `workflow_dispatch`     | CD accepts only runs from the matching CI mode     |

The full test chain is therefore real: `ci-all` in test-run mode uploads a test artifact, and `cd-pages` in test-run
mode is dispatched with that run's ID.

**The one job with no gate twin:** `CI gate` must exist exactly once per run and must never be skipped. A skipped job
counts as passed, so a skipped production gate in a test run could report a pass for the commit under the required name.
It needs both twins of every job, holds no permissions or environment, and only reads results. A successful test run
therefore posts a passing `CI gate` on its commit. That run executed the same steps with `run_all`, so the result is
sound, but step 5 confirms how GitHub treats two `CI gate` results on one commit. `run_all` defaults to `true` on manual
runs, so a narrowed run is also a deliberate choice.

**The evidence check** is a job limited by `if: github.event_name == 'pull_request'`, not by mode, because a test run
looking for its own success could never pass. Job-level event conditions are allowed; only branching on `test_run` is
not.

**The one deploy twin that differs:** `actions/deploy-pages` has no target input and always publishes to the repository
it runs in, so GitHub Pages offers no test-run destination. Owner decision: `deploy-test-run` is a dummy job for now. It
runs in the `test-run` environment with read-only permissions, publishes nothing, and logs what production would have
published: the artifact name and digest, source run and commit, file count, and target, in `$GITHUB_STEP_SUMMARY` and
stdout. `prepare-test-run` remains a true twin. A second repository just for testing is not worth its setup while Pages
is the host. Replace the dummy with a real test job when moving to another provider.

### CI and CD split

`cd-pages.yml` runs separately from CI, as a `workflow_run` of `ci-all.yml`. Considered:

| Option                         | Assessment                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Deploy job inside CI, as today | CI needs `pages: write` and the production environment, so there is no real separation          |
| `cd-pages.yml` called from CI  | Tidier files, but it is the same run, and CI must still grant the deployment permissions        |
| `workflow_run` of CI (chosen)  | Separate run and permissions; CI stays read-only; keeps automatic deployment; supports rollback |
| Release or manual trigger only | Fully meets the personal rule, but ends automatic deployment, which the owner keeps for now     |

Moving to releases later changes only the trigger, so this choice does not block it.

How it works:

- **CI side:** `ci-apps-web` uploads `$WEB_ARTIFACT_NAME` with `$WEB_ARTIFACT_RETENTION_DAYS`, 30 days being the
  rollback window. It never uploads a Pages artifact. A green `CI gate` says nothing about deployment, and a failed
  deployment never blocks PRs.
- **Which runs deploy:** the CI run must have concluded `success`, come from `$CI_SOURCE_EVENT`, also on `main` when
  that event is a push, and hold the named artifact. Docs-only, nightly, and test runs therefore never deploy to
  production. Finding no artifact is a normal skip and is noted in the summary.
- **Copy, do not rebuild:** `prepare` downloads the artifact by run ID and re-uploads it with `upload-pages-artifact`,
  because `deploy-pages` reads only from its own run. There is no checkout, so CD cannot depend on source.
- **Ordering:** `concurrency` uses one `cd-pages` group without cancelling, and on automatic runs `prepare` skips a run
  when a newer `ci-all` run has succeeded with an artifact. Otherwise a slow older run could overwrite a newer
  deployment. This replaces comparing with the last deployed commit: a Pages deployment records the head of `main` when
  CD ran, not the artifact's commit. If the newer run's deployment fails, that failure shows in `cd-pages`, and the
  older run stays skipped. Comparing with `main`'s head would be wrong, because a later docs-only merge must not stop a
  web deployment.
- **Rollback:** dispatch `cd-pages.yml` with `test_run=false` and an older `run_id`. The release runbook's revert path
  stays for anything older than 30 days. The ordering check applies only to automatic runs.
- **Test-run mode:** `prepare-test-run` runs in full, and `deploy-test-run` only logs the expected result. The real
  publish step and the `workflow_run` trigger are therefore proven only by the cutover in step 4.

### Owner decisions, 2026-11-04

These settle conflicts with the personal `cicd-general` and `cicd-github` rules. Record the exceptions in the workflow
comments.

| Question                                                             | Decision                                                                                                  | Revisit when                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Should PR checks run automatically?                                  | Yes, as an exception to the manual-approval rule, because auto-merge needs it.                            | Actions quota limits become a concern.                                  |
| Should Pages keep deploying automatically after merging to `main`?   | Yes, as an exception to the release-or-manual rule, through the `workflow_run` split above.               | The map is past its testing phase.                                      |
| Should docs-only merges to `main` skip browser tests and deployment? | Yes. The nightly full run covers planning mistakes.                                                       | The nightly run catches a real miss.                                    |
| Should this include `test_run` and `act`?                            | Yes, for all new workflows, with testing instructions in `.github/`.                                      | -                                                                       |
| Should `.github/**` changes run every folder on the PR?              | No. They run lint and platform tests, and must pass test runs locally and on GitHub (Decision 8).         | -                                                                       |
| Should `ci-*` workflows have `-test-run` twin jobs?                  | Yes. The skills and their docs apply as written. `CI gate` has no twin, and `deploy-test-run` is a dummy. | -                                                                       |
| Is the `workflow_run` CI and CD split approved?                      | Yes.                                                                                                      | The map is past its testing phase.                                      |
| Should test-run mode publish to a second repository?                 | No. `deploy-test-run` is a dummy job that logs the expected result, an exception to the same-steps rule.  | Moving from GitHub Pages to another provider: add a real test job then. |

`actionlint` 1.7.12 and `gh act` 0.2.88 run the workflows on this machine, and `actionlint` accepts YAML anchors.

## Change rules

The planner adds together every row that matches.

| Changed                                                                                           | Runs                                                                               |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Any `.md` file, except under `apps/web/public`                                                    | `docs`                                                                             |
| `services/backend` Go code, `go.mod`, `go.sum`                                                    | `backend`                                                                          |
| `services/backend/Makefile`                                                                       | `backend`, `platform`                                                              |
| `services/transit-relay/**`                                                                       | `transit-relay`, `tests`                                                           |
| `tests/**`                                                                                        | `tests`                                                                            |
| `data/tools/**`, `data/tests/**`                                                                  | `data`                                                                             |
| `data/sources/**`, `data/artifacts/**`, `data/imagery/**`                                         | `data`, `apps-web`, `tests`, `platform`, all browser areas                         |
| `packages/contracts/**`                                                                           | `contracts`, `data`, `backend`, `apps-web`, `tests`, `platform`, all browser areas |
| `apps/web/**`                                                                                     | `apps-web`, `tests`, `platform`, browser areas below                               |
| `platform/pages/**`, `platform/tools/serve.py`                                                    | `platform`, `apps-web`, all browser areas                                          |
| `platform/**`, otherwise                                                                          | `platform`                                                                         |
| `.github/**`, except Markdown; `platform/tools/ci-plan.mjs`                                       | `workflows`, `platform`                                                            |
| Any `Makefile` not listed above                                                                   | The owning folder, `platform`                                                      |
| Root files: `package.json`, `package-lock.json`, `.node-version`, `Makefile`, `eslint.config.mjs` | Everything                                                                         |
| Any path the rules do not match                                                                   | Everything                                                                         |

Confirmed in step 2 from the build tools and the specs:

- `services/transit-relay/**` selects no browser area. Specs stub the hosted relay's URL with `page.route`, and the
  suite never serves relay code.
- Apart from root `AGENTS.md`, which `platform/tests/agents.test.mjs` reads and which therefore also selects `platform`,
  no build, data, or test tool reads Markdown outside `apps/web/public`. `build.mjs` filters `data/imagery` Markdown
  from the artifact, and `check-repo` reads Markdown only to check links, which `docs` covers.
- `data/tools/pack.py` appears in `platform/tests` only as an example path, so `data/tools` does not select `platform`.

### Browser areas

| Area          | Specs                                 | Selected by, on PRs only                                                                                                                                      |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`       | `shell`, `updates`                    | `sw.js`, `offline.js`, `data-mode.js`, `app-updates.js`, and its specs                                                                                        |
| `journeys`    | `journeys`                            | `routing`, `transit-routing`, `route-planner`, `transport`, `vehicle-direction`, `point-selection`, `object-selection`, `map-taps`, `satellite`, and its spec |
| `interface`   | `interface`                           | `interface.js` and its spec                                                                                                                                   |
| `discover`    | `discover`                            | `position.js` and its spec                                                                                                                                    |
| `poi-desktop` | `poi-visibility`, `root-desktop` only | `place-visibility.js`, `poi-icons.js`, and its spec                                                                                                           |
| `poi-mobile`  | `poi-visibility`, `pages-mobile` only | Same as `poi-desktop`                                                                                                                                         |

These run every area: `app.js`, `core.js`, `map-style.js`, `style.css`, `index.html`, `helpers.mjs`, `serve.py`,
`update-server.mjs`, `playwright.config.mjs`, `apps/web/tools/**`, `apps/web/package.json`, and anything unmapped.
Changes to `apps/web/tests/*.test.mjs` run no browser area.

## Steps

Make each step its own PR. Create a worktree first: `make worktree NAME=<branch>`.

### 1. Speed up the current browser jobs, with no planner

This is the largest gain and depends on nothing else.

- In `web.yml`, split `places` into `discover`, `poi-desktop`, and `poi-mobile`, passing `--project` through `E2E_ARGS`.
  No test changes.
- Investigate the 5m40s Chromium install from run 41843418732. Found: the time goes to slow font package downloads from
  the Ubuntu mirror, about 141 kB/s in the slow cases. It recurred (168s in run 41861532706), and short apt timeouts do
  not help because data keeps trickling. `.github/actions/setup-browser` therefore caches the downloads, and limits the
  install to 360s. A 240s limit failed a job on a slow mirror in run 41867127404.
- Keep the cache rather than build a CI image, as `ivanov-gv/zpcg` does. Cached setup takes 14-36s per job, and the
  ready-made Playwright image alone is 878 MB compressed for each job to pull and unpack, so an image would remove the
  mirror risk without being faster, and would add a workflow to build and update it. Revisit if a cache miss regularly
  hits the slow mirror.
- Keep the job timeout at 15 minutes: the slowest job measured is 8.3 minutes, including a slow install and a run while
  GitHub reported degraded service.
- Slowest tests in run 41845205724, all in `poi-visibility` unless noted: `stability: small pans...` 58s desktop, 41s
  mobile; `every level is absent just below its threshold...` 50s and 37s; `a broad filter admits only eligible...` 32s
  and 22s; `shipped snapshot downloads and reloads offline` (`shell`) 38s and 21s. Fixed `waitForTimeout` calls total
  about 13s per project, so they are not where the time goes.
- Do not adopt `workers: 2`. Measured with `--workers=2` in run 41861615927 against `workers: 1` in run 41861532706, it
  cut `journeys` from 5.0m to 2.7m and `poi-desktop` from 5.2m to 2.9m, but `shell` and `journeys` each gained a flaky
  test and `poi-mobile` slowed from 2.5m to 3.7m. `updates.spec.mjs` itself is safe: its server takes a free port.
- Update the area table in `docs/verification/testing.md`.

### 2. Add the planner, with no CI change

- Confirm the open questions under "Change rules".
- Add `platform/tools/ci-plan.mjs`. Input: a list of changed files. Output: which folders and browser areas to run, as
  `GITHUB_OUTPUT` lines and readable text, also written to `$GITHUB_STEP_SUMMARY` and stdout.
- Base the diff on `git diff --name-only --no-renames <base>...<head>`, so both sides of a rename count, and deleted
  files count. A `main` push diffs from the `before` commit. A zero `before` SHA selects everything. A checkout with
  full history and `filter: blob:none` should keep this cheap despite the map archive; confirm it.
- Add `make ci-plan BASE=origin/main`.
- Add `platform/tests/ci-plan.test.mjs` with a table of paths and expected output, covering docs-only, Go-only, Go plus
  docs, `go.mod`, web source, shared web source, data, contracts, Markdown in `apps/web/public`, a rename across
  folders, `.github/**`, an unknown path, an empty diff, and a change to the planner itself.
- Add drift tests:
  - Every component in `verify.mjs` must have a folder rule, so a new folder cannot silently skip checks.
  - Every file in `apps/web/src` and every spec must be mapped to an area or to run-everything.
  - Every spec must belong to an area in the matrix, and the matrix must cover both projects.
- Add a parity check that the folder checks together cover everything in `make check`. Today only linting
  `eslint.config.mjs` is missing, so add it to `platform`'s lint.
- Replay the commit history through the planner, and record the result here. Result on 30 commits: 5 docs-only, 1 with
  no browser tests, 1 narrowed to some areas, 12 with every area, and 11 selecting everything, mostly through root
  files.

### 3. Add the new workflows beside the old ones

A workflow can be dispatched only after it exists on `main`, so the new files must land before they can be tested and
before the evidence check can apply.

- Create the `dev` and `test-run` environments and their vars. Done with the owner's approval on 2026-11-04, along with
  the same vars on `github-pages`.
- Add `.github/actions/test_run`, and use the job pairs and anchors from "Test-run model" in every workflow.
- Add `ci-all.yml`, all `ci-*` folder workflows, and `cd-pages.yml`. Add a composite action for each shared setup: the
  existing `setup-web`, plus Go setup. `ci-backend` keeps working without Node; `ci-all` decides whether to call it, so
  it needs no plan input.
- `cd-pages.yml` is dispatch-only in this step, so the old workflow stays the only one deploying.
- Add `make test-<workflow>` targets for each workflow using `ACT ?= gh act`, `--secret-file` and `--var-file` from
  `.github/act/`, listed under `make test-all-workflows`, working with `ACT="act -n"`. Confirmed: `act` handles local
  called workflows, a matrix, and artifacts, with limits. Its artifact server rejects `upload-artifact@v6` and
  `upload-pages-artifact@v5`, so these workflows use `@v5` and `@v4`. Its runner image has no `gh`, so `cd-pages` calls
  the API with `curl`. It also runs matrix jobs in parallel on the host network, where they share a port, so targets use
  `--network bridge`.
- `CI gate`:
  - `if: always()`, and `needs` includes `plan`, `plan-test-run`, and every folder, so a failed plan fails the gate.
  - Fails if any result is `failure` or `cancelled`. `skipped` passes.
- Later jobs that need a possibly skipped job guard with `!cancelled()` and check that job's result.
- On PRs set `cancel-in-progress: true`. Give each run on `main` its own concurrency group: GitHub keeps one pending run
  per group, so a shared group could drop a web merge's run in favor of a later docs merge. `cd-pages` handles
  deployment order.
- A nightly `schedule` selects every folder and area.
- `run-name` shows `test-run` and `run_all`, so the evidence check can identify a qualifying run.
- Add `.github/TESTING.md` covering the three ways to run: locally with `act` in test-run mode, on GitHub with
  `gh workflow run ci-all.yml --ref <branch> -f test_run=true -f run_all=true`, and through a real PR. Include how to
  install `act` and how to check selection with `make ci-plan`.
- Add to `.github/pull_request_template.md` a section for workflow changes, recording the local command and result.
- Add the evidence check to `ci-workflows`, enabled once a qualifying dispatch is possible. Its failure message gives
  the exact commands. After the dispatch run succeeds, the author re-runs the failed check, so auto-merge can continue.
- Run every workflow in test-run mode, locally and on GitHub, including the chain from `ci-all` to `cd-pages` with a
  test artifact, and check that `deploy-test-run` logs the expected result. Record the links in Verification.

### 4. Cut over to the new workflows

- Add the `workflow_run` trigger to `cd-pages.yml`, limited to `branches: [main]`, and remove `web.yml` and
  `backend.yml` in the same PR, so there is never a double deployment or a gap.
- Rewrite the tests that read the old files, keeping what they protect:
  - `platform/tests/markdown.test.mjs`: "web CI includes backend Markdown changes" becomes a planner assertion.
  - `platform/tests/makefiles.test.mjs`: the backend check must still run from `ci-backend.yml`, with no Node.
- Add a test that no `ci-*` workflow requests `pages` or `id-token` permissions or names any environment other than
  `dev` and `test-run`, that `cd-pages.yml` does not check out the application, and that every job except `switch` and
  `CI gate` has a `-test-run` twin, sharing steps except `deploy-test-run`, which requests no write permissions.
- Confirm that the first web merge deploys through `cd-pages.yml`, and that a docs-only merge does not.
- Prove a rollback by dispatching `cd-pages.yml` with an older `run_id`, then redeploying the current one.

### 5. Add browser area selection and prove the gate

Keep this separate, so the area mapping can be reverted alone.

- `ci-apps-web.yml` takes the selected areas as a JSON matrix. `main` and nightly runs always pass every area.
- Report in the step summary whether a run narrowed the areas, then review the hit rate after a few weeks.
- Open throwaway PRs and record the result of each in Verification:

| PR                           | Expected                                          |
| ---------------------------- | ------------------------------------------------- |
| Markdown only                | Only `docs` runs; gate passes                     |
| Go only                      | Only `backend` runs; gate passes                  |
| `interface.js` only          | `apps-web` and only `interface` area; gate passes |
| `app.js`                     | Every browser area; gate passes                   |
| Docs and Go together         | `docs` and `backend` run; gate passes             |
| Broken Markdown              | `docs` fails; gate fails                          |
| Failing browser test         | Its area fails; gate fails                        |
| Cancel a running job         | Gate fails                                        |
| New unknown top-level folder | Everything runs                                   |
| `.github/**`, no test run    | `workflows` fails; gate fails                     |
| `.github/**`, with test run  | `workflows` passes after a re-run; gate passes    |
| Failed PR run, then test run | Record how GitHub treats both `CI gate` results   |

### 6. Turn on the requirement (owner) and update docs

The owner makes this change in [the `main` ruleset](https://github.com/ivanov-gv/cg-map/settings/rules/26320147), after
`CI gate` has run at least once:

1. Set **Enforcement status** to **Active**. This also starts blocking force-pushes to `main` and deleting it.
2. Tick **Require status checks to pass** and add `CI gate`.
3. Leave **Require branches to be up to date before merging** off, because Decision 7 covers that risk.
4. Add a bypass for the owner if direct pushes to `main` should stay possible.

Then confirm with a real PR that `gh pr merge --auto --squash` waits, merges when green, and does not merge when red.

Update these docs in the same change as the behavior they describe:

- `docs/runbooks/release.md`, which names `web.yml`, its triggers, and rollback
- `docs/verification/testing.md`, on what runs where, and its "no path filtering yet" statement
- `apps/web/AGENTS.md`, which describes the CI browser jobs
- `docs/engineering/README.md`, on enforcement
- `platform/README.md` and `AGENTS.md`, for new commands and the auto-merge command

## Risks

| Risk                                             | Mitigation                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| The planner skips a folder a change needed       | Fail-safe default, drift tests, parity check, nightly full run                                              |
| An area mapping misses a regression on a PR      | Shared code runs every area; `main` runs the full suite before deploying, so the miss cannot reach users    |
| Two PRs pass alone and break together            | Nightly run; turn on "up to date" if it happens often                                                       |
| `.github/**` merges without running every folder | The GitHub test run with `run_all` must pass at the PR's head commit                                        |
| The local `act` run is skipped                   | Recorded in the PR template only; CI cannot verify it                                                       |
| `act` cannot run part of a workflow              | Confirm in step 3 and record the gap in `.github/TESTING.md`; the GitHub test run still covers it           |
| The publish step and `workflow_run` are untested | They run only from `main`, so step 4 proves them on a real merge; the runbook's revert path stays available |
| Twin jobs drift apart                            | Shared anchors, and a test that every job has its twin; duplicated `env:` blocks need care in review        |
| Environments add deployment noise to PRs         | Each job using an environment records a deployment; accept it, or look for a way to quiet it in step 3      |
| A test run posts a passing `CI gate`             | It ran the same steps, and `run_all` defaults to `true`; step 5 records GitHub's actual behavior            |
| A slow older run overwrites a newer deployment   | Ordering check in `cd-pages.yml`                                                                            |
| CD fails with no signal on the PR                | Failed runs are visible in Actions; the release runbook's check after merging names `cd-pages`              |
| The required check name changes                  | The name `CI gate` is fixed; the planner and folders can change freely                                      |
| `CI gate` is required before it works            | Step 5 comes before step 6                                                                                  |
| A broken workflow blocks every merge             | The owner's bypass, or reverting the workflow PR                                                            |
| Parallel browser tests become flaky              | Adopt `workers: 2` only on measured evidence; the split alone gives most of the gain                        |

## Progress

- Completed: this plan.
- Completed: steps 1 to 3 on `main`.
- In progress: steps 4 and 5 together, at the owner's direction: removing the old workflows and selecting browser areas.
- Remaining: the throwaway PRs in step 5, and step 6.

## Verification

Step 1, run 41861532706, on 2026-11-04 during degraded GitHub service: web build 29s, then `shell` 163s, `discover`
112s, `interface` 207s, `journeys` 340s, `poi-mobile` 184s, and `poi-desktop` 500s, of which 168s was a slow install. A
full run took about 9 minutes, down from 10-12. Without a slow install it would be about 6.5 minutes.

Step 3, locally: `make test-ci-all` passed every folder, all six browser areas, and `CI gate`. `make test-cd-pages` read
real run 41869977068, with its production artifact name and event overridden, because no test run can exist before this
is on `main`. It copied the artifact, and `deploy-test-run` logged the source, digest, 69 files, and target.

Step 3, on GitHub: run 41872158001 on PR 12 passed `CI gate`. Cached browser setup took 14-36s per job, the longest
browser job took 307s, and the whole `plan` job took 14s, so the full-history checkout stays cheap.

Record the commands, run links, and measured times here for steps 2 to 5.

## Handoff

Each step is its own PR, and steps after 3 need the earlier ones merged, because GitHub dispatches a workflow only once
it exists on `main`. Baseline timings come from run 41845205724, and the slow browser install from run 41843418732.
