# Testing workflows

Running a workflow is the only way to know it works, so a change to `.github/**` must run in test-run mode locally and
on GitHub. Pipeline structure and reasoning: [the CI plan](../docs/plans/change-aware-ci.md).

## Test-run mode

Every job has a `-test-run` twin with the same steps, selected by a `test_run` input. The twins use the `test-run`
environment, whose variables keep test artifacts apart from production ones. Local runs always use it, and manual runs
default to it. `CI gate` has no twin, and `deploy-test-run` logs what production would publish, because GitHub Pages has
no test destination.

The `dev`, `test-run`, and `github-pages` environments each define these variables:

| Variable                      | `dev` and `github-pages` | `test-run`              |
| ----------------------------- | ------------------------ | ----------------------- |
| `WEB_ARTIFACT_NAME`           | `web-artifact`           | `web-artifact-test-run` |
| `WEB_ARTIFACT_RETENTION_DAYS` | `30`                     | `1`                     |
| `CI_SOURCE_EVENT`             | `push`                   | `workflow_dispatch`     |

## Locally with act

Needs Docker and `gh extension install nektos/gh-act`.

```sh
make test-ci-docs                       # one workflow
make test-ci-all                        # everything CI runs, one job at a time
make test-cd-pages RUN_ID=<run ID>      # reads a real ci-all test run from GitHub
make test-all-workflows ACT="gh act -n" # dry run of every target
```

A dry run only checks that a workflow parses, so it does not count as a test.

## On GitHub

A workflow can be dispatched only once it exists on `main`. After that, dispatching runs your branch's version:

```sh
gh workflow run ci-all.yml --ref <branch> -f test_run=true -f run_all=true
gh workflow run cd-pages.yml --ref <branch> -f test_run=true -f run_id=<ci-all test run ID>
```

`ci-workflows` fails a PR that changes `.github/**` until a successful `ci-all` test run exists for its latest commit,
and a `cd-pages` test run too when that workflow or a composite action changed. After those runs pass, re-run the failed
check. CI cannot see local runs, so record yours in the PR template.

## Through a real PR

`ci-all` runs on every PR and selects pipelines from the diff. To see what a branch would select:

```sh
make ci-plan BASE=origin/main
```

The `workflow_run` trigger and the real publish step run only from `main`, so only a real merge proves them.
