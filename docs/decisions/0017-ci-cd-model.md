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
- Almost every CI job declares `environment: dev` to read variables, creating about 15 deployments per PR run (#165).
- The `ci-approval` environment has no required reviewers, so the gate never actually waits (#169).
- PR runs take 4.5-10 minutes end to end, exceeding the 5-minute target.
- ADR 0006 states that "a push to main runs no checks" and only publishes, which treats the deploy as a CI consequence.

These gaps need recording so the model is documented in one place and the features that implement it have a reference.

## Decision

- **Pages build from source.** CI (`ci-dev-pages`) builds the dev site from source on every commit to main, with a
  `/version.json` carrying the SHA, and uploads the artifact with `upload-pages-artifact`. This replaces the
  `:main`-image approach: the site is no longer assembled from mutable images.
- **Pages CD trigger.** The CD workflow triggers on `page_build` if a spike confirms it fires with Pages
  `build_type: workflow`; otherwise it triggers on `push` to main. Both are valid CD triggers under the wiki model. CD
  deploys that exact artifact with `deploy-pages` and never rebuilds it.
- **Pages CD test-run twin.** The CD workflow runs everything up to `deploy-pages`. Pages has no test destination, so
  that step is the documented exception to the test-run rule.
- **Workflow naming.** `ci-all` is split into `ci-pr-checks` (the diff-aware PR workflow) and `ci-nightly` (the full run
  on main). One workflow per concern.

  **Outcome (#166, 2026-11-15):** `ci-publish` was added as a third workflow for pushes to main that build and publish
  images and packages. ci-dev-pages no longer depends on ci-publish.

- **PR time budget.** The whole run, from approval to `CI gate`, warns over 5 minutes and fails over 7. The per-job
  limits of ADR 0006 stay.

  **Outcome (#169, 2026-11-15):** enforced by `CI gate`; the clock starts at the later of the approval and the run
  attempt's start, so re-runs keep their budget. Details: .github/TESTING.md.

- **Environments only where they are read** (#165). GitHub environments are named sets of variables and secrets; `dev`
  and `test-run` define the same names, and test-run twins read safe values from `test-run` (the test-run model). A
  production job references `dev` only when it reads its variables or secrets; jobs that read neither reference no
  environment, and every test-run twin uses `test-run`. GitHub records a deployment for each job that references an
  environment, so these records are expected and are not deploys.
- **Approval gate** (#169). The owner decides whether to add required reviewers to `ci-approval` or remove the gate
  entirely. The decision records the plain string form (`environment: dev`), because act rejects `deployment: false`.

  **Outcome (#169, 2026-11-15):** the gate passes automatically until the owner adds required reviewers; adding a
  reviewer later needs no workflow change.

These decisions supersede the Pages-as-CI-step and `:main`-image parts of
[ADR 0005](0005-packages-releases-and-dev-pages.md), and the "push to main updates dev" part of
[ADR 0006](0006-ci-time-limits-and-tests-before-merge.md).

## Skill deviation

`agents:cicd-general` "CD workflows" rules 2 and 3 require CD to trigger on a release or manual trigger, and forbid push
triggers. This project's Pages CD triggers on `page_build` or a push to main instead, because Pages is a development
site that should update automatically when code lands.

## Consequences

- CI no longer deploys, matching the wiki model. The Pages deploy is a separate CD workflow.
- The dev site carries a version that traces back to the commit, instead of a mutable `:main` image.
- The split separates concerns: `ci-pr-checks` handles PR checks and `ci-nightly` runs the full suite. Any speed-up
  comes from #169's re-sharding.
- Deployment records come only from jobs that read an environment, instead of from almost every CI job.
- The approval gate can actually hold PRs once reviewers are configured.
- The features that implement this decision are #164 (this ADR and actionlint), #165 (environments only where they are
  read), #166 (workflow split), #167 (Pages build from source), #168 (Pages CD and its trigger), and #169 (time budget
  and approval).
- The Pages deploy step is never exercised in a test run.
- The `page_build` trigger depends on a spike to confirm it fires.
- Building from source drops the image reuse that ADR 0005 relied on.
- Pushes to main run more workflows.
- CD on a push to main deliberately follows the wiki rule over the personal skill's no-push rule.

**Outcome (#168, 2026-11-15):** the spike found page_build never fires with build_type workflow; cd-dev-pages triggers
on push to main and polls for its SHA's ci-dev-pages run, so CI never triggers CD.
