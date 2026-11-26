# Plans

This folder holds the history of work in progress. A GitHub issue is the source of truth for each task: its scope,
status, sub-issues and "blocked by" dependencies. The task's plan, written from the [template](TEMPLATE.md), links the
issue and records how the plan changed and why. A plan stays until its issue is resolved, and the PR that resolves it
deletes it. Git history keeps deleted plans.

- [Internal layer editor](internal-layer-editor.md): source inventory, shared map, editing slices and HTML draft. Slices
  1 to 6 and the offline install are merged, with listed gaps.
- [Entity IDs and data releases](entity-ids-and-data-releases.md): issue #30. OSM IDs on every object, parallel fixes as
  ordinary PRs, tagged data releases.
- [Editable layers](editable-layers.md): Epic #404. Every layer of the map editable, as nine stacked Features.
- [Faster browser tests](faster-browser-tests.md): CI jobs are split to fit their limit; the remaining steps towards a
  5-minute full suite locally.
- [Web tests next to their components](web-tests-next-to-the-components.md): issue #456; test relocation, build-derived
  lists and browser reduction, with the lists/harness step recorded.
- [Automatic workflow test runs](auto-workflow-test-runs.md): issue #334; planned move from manual test-run evidence to
  reusable CI calls and dispatched CD runs inside `CI gate`.
- [Project-owned ESLint configuration](project-owned-lint-configuration.md): issue #458; #466 recovered as a shared-rule
  foundation, with app migrations held for their own PRs.
