# 0017: CI/CD model: CI builds, CD deploys

## Status

Accepted.

## Context

The wiki defines a clear CI/CD model: CI and CD are separate pipelines. CI never deploys; CD deploys commit-versioned
artifacts. Dev is GitHub Pages. PR CI should take under 5 minutes and never over 7. One workflow per concern and per
project. Pipelines are tested with actionlint, act, and a dispatch test run.

Today's implementation deviates from this model in several ways:

- `ci-all` deploys Pages as a CI step, blurring the CI/CD boundary described in ADR 0005.
- The dev site is assembled from `:main` images, which are mutable tags that change on every merge (ADR 0005).
- Every CI job declares `environment: dev` to read variables, creating about 15 deployments per PR run (#165).
- The `ci-approval` environment has no required reviewers, so the gate never actually waits (#169).
- PR runs take 4.5-10 minutes end to end, exceeding the 5-minute target.
- ADR 0006 states "push to main updates dev," which treats the deploy as a CI consequence.

These gaps need recording so the model is documented in one place and the features that implement it have a reference.

## Decision

- **Pages build from source.** The dev site is built from source at the commit, with a `/version.json` carrying the SHA.
  This replaces the `:main`-image approach: the site is no longer assembled from mutable images.
- **Pages CD trigger.** The CD workflow triggers on `page_build` if a spike confirms it fires with Pages
  `build_type: workflow`; otherwise it triggers on `push` to main. Both are valid CD triggers under the wiki model.
- **Pages CD test-run twin.** The CD workflow runs everything up to `deploy-pages`. Pages has no test destination, so
  that step is the documented exception to the test-run rule.
- **Workflow naming.** `ci-all` is split into `ci-pr-checks` (the diff-aware PR workflow) and `ci-nightly` (the full run
  on main). One workflow per concern.
- **PR time budget.** The whole run is measured from approval to `CI gate`. A job warns over 5 minutes and fails over 7.
- **CI jobs read variables without creating deployments** (#165). CI jobs that do not deploy must not declare an
  environment solely to read variables.
- **Approval gate reviewers are an owner decision** (#169). The `ci-approval` environment's required reviewers are
  configured by the repository owner, not hardcoded in the ADR.

These decisions supersede the Pages-as-CI-step and `:main`-image parts of
[ADR 0005](0005-packages-releases-and-dev-pages.md), and the "push to main updates dev" part of
[ADR 0006](0006-ci-time-limits-and-tests-before-merge.md).

## Consequences

- CI no longer deploys, matching the wiki model. The Pages deploy is a separate CD workflow.
- The dev site carries a version that traces back to the commit, instead of a mutable `:main` image.
- PR runs are faster because `ci-pr-checks` is diff-aware and `ci-nightly` runs separately.
- Fewer spurious deployments are recorded, since CI jobs no longer declare `environment: dev` unnecessarily.
- The approval gate can actually hold PRs once reviewers are configured.
- The features that implement this decision are #164 (this ADR and actionlint), #165 (CI without deployments), #166
  (Pages from source), #167 (Pages CD trigger), #168 (workflow split), and #169 (time budget and approval).
