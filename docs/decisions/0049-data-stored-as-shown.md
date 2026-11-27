# 0049: Data is stored as it is shown, and validated, not derived

## Status

Accepted. Replaces [ADR 0048](0048-ridges-are-drawn-slopes-derived.md): slopes are not derived from ridges. Refines
[ADR 0039](0039-strong-foundation-before-v1.md) and the derived-shape part of [ADR 0037](0037-every-layer-editable.md).
Implements [#507](https://github.com/ivanov-gv/cg-map/issues/507).

## Context

The audit in #507 found facts stored twice and derived values stored as facts. Examples: ridges and slopes, municipality
polygons next to border edges, building labels, summit check results, and values computed by both the importer and the
Editor. A derivation needs the same code in every place that shows its result. If the Editor lacks it, an edit cannot be
previewed at once. If the Editor has a copy, the two can disagree. The owner decided the rules below on 2026-11-27.

## Decision

- **An object is stored as it is shown.** The sources hold the shapes and values the map displays, so the Editor
  previews every edit at once. No compilation step and no derived value stands between a source and what is shown.
  Display rules that map-core's style evaluates per feature, such as a contour every 100 m drawn bold, are styling, not
  data.
- **Every rule the data must meet has a validation.** No inconsistency may reach a release. Data's checks run before
  every release and catch all of them.
- **An edit cannot create an inconsistency by its design.** Where two objects must agree, one edit changes both. For
  example, moving a shared municipality border moves it in both polygons at once.
- **One rule validates one file.** Objects that must agree live in the same file, so their check and the edit that keeps
  them consistent read one file. Cross-file validations are avoided.
- **Each check is one JavaScript module in data, published in `@ivanov-gv/map-data`.** `check-data` runs it before a
  release, and the Editor imports the same module for instant warnings on each edit.

## Consequences

- Shades are stored as polygons linked to their green area. Ridges, slopes and the slope derivation go away.
- Municipality polygons are stored, and their shared borders are kept equal by the Editor's shared-edge edits and by a
  topology check.
- Building labels, the sea and other derived values become stored, shown facts or style rules, as #507 lists.
- Checks written in Python move to JavaScript, so the Editor can import them.
- Shared borders store the same line in two polygons. The edits and the checks keep them equal; that is the accepted
  cost of instant previews without a derivation.
