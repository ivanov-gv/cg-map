# 0034: One deployment record per workflow run

## Status

Accepted.

## Context

[ADR 0017](0017-ci-cd-model.md) limited environments to jobs that read their variables or secrets, but GitHub still
recorded a deployment for every such job. A release run produced several records, and every test-run twin added another,
so environment history could not answer which job actually changed a target. Since March 2026 a job can name an
environment without recording a deployment: `environment: {name: <env>, deployment: false}`. The job still receives that
environment's secrets and variables.

## Decision

A run records at most one deployment. Every other environment-bearing job uses the mapping form with
`deployment: false`. The choices, also documented in [Testing workflows](../../.github/TESTING.md), are:

- A CD run records one deployment from the last job that changes the target: the package publisher or promoter in the
  package and browser-image CD workflows, and `deploy` on `github-pages` in `cd-dev-pages`. The `find` job still reads
  `dev` variables, but does not record a deployment.
- A CI run records none. Publishing dev images and packages is not a release, so every CI job that reads `dev` variables
  uses `deployment: false`.
- The `ci-approval` gate records none. It names `ci-approval` for protection, not to change a target.
- Every `-test-run` twin records none. A test run exercises the same steps against test destinations; it is not a
  release.

Platform's workflow tests assert the exact deploying job per workflow and that every test-run twin is non-deploying.

## Consequences

- Environment history shows one deployment for each real CD release and none for CI or test runs; its status is the
  chosen job's status, so a later job's failure does not mark that deployment failed.
- Required reviewers and wait timers still apply to every job that names an environment, even with `deployment: false`.
  Custom deployment protection rules need a deployment object, so they cannot be used on those jobs; none are configured
  today.
- actionlint 1.7.12 accepts the key. Released `act` 0.2.88 and 0.2.98 reject it, so local runs use the 0.2.98 build from
  [nektos/act#6243](https://github.com/nektos/act/pull/6243) commit `0f761c049dc3`;
  [Testing workflows](../../.github/TESTING.md) builds it and `make` refuses other versions until a release includes it.
