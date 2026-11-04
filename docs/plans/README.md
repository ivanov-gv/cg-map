# Plans

This folder holds task-specific plans, including completed plans retained for historical context. Use the
[plan template](TEMPLATE.md) for a new multi-session change; update plans when their scope or acceptance criteria
change.

- [Stable POI visibility levels](stable-poi-visibility.md): cumulative icon thresholds, deterministic placement, data
  overrides, and acceptance checks; implemented, with device density review pending.
- [Laconic map interface](laconic-interface.md): completed control-layout work; POI visibility was explicitly separate.
- [Monorepo CI and separate CD](change-aware-ci.md): one pipeline per folder, diff-aware browser areas, a required
  `CI gate`, and CD split from CI; in progress.
