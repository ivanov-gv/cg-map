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
  them consistent read one file.
- **Following a link is the only computation and the only cross-file check.** An object may link to an object in another
  file by its `entityId`. A cross-file check only confirms that the target exists. The build copies a linked value into
  the tiles, such as a street's name onto its roads, and the Editor's preview makes the same copy. Nothing else is
  computed from another object, because that would need the same computation in data and in the Editor.
- **Style reads only the feature's own properties.** map-core may choose a look from a feature's own values: a road from
  its type and its `layer`, `bridge` and `tunnel` tags, a POI's icon from its kind, a settlement's size from `place` and
  `population`. A look never depends on another object, such as a road on the green area it crosses.
- **Tiles are build output.** The build publishes stored features into tile layers, cut and simplified per zoom, and
  copies stored or linked values. It computes no new value.
- **One object, one feature, one identity.** Each object has one `entityId`: the OSM identity, or `local:<uuid>` when
  made in the Editor. No property copies it. A POI that is another object, such as a hotel building, a summit that is a
  viewpoint, or a lake that is an attraction, lives on that object, with its tags and a stored `iconPoint`, so both its
  outline and its icon open the same card. A POI that only stands inside another object keeps its own feature and a link
  to that object.
- **A concept the map shows is an object, even without a shape.** A street is an object with its name, and the road ways
  of the street link to it. A junction where something is stated about it, such as a level above or below ground, a
  crossing or a turn restriction, is a point object that the roads meeting there link to.
- **Labels and icons are stored where they are shown.** A label point, a label line or an icon point is a stored value
  that the owner can move, never a position computed by the build.
- **New structures are seeded once, and no value is invented.** A change of structure seeds the new shape once from
  today's data, so the map looks as before. A value that the sources do not have stays absent. For example, a summit
  without an OSM height shows no height.
- **OSM's shape is converted only at its boundary.** An OSM import groups and links what OSM stores differently, such as
  the ways of a street. An export writes OSM's form back, such as `addr:street`. Nothing between the two converts again.

## Consequences

- Shades are stored as polygons linked to their green area. Ridges, slopes and the slope derivation go away.
- Municipality polygons are stored, and their shared borders are kept equal by the Editor's shared-edge edits and by a
  topology check.
- Building labels, the sea and other derived values become stored, shown facts or style rules, as #507 lists.
- Shared borders store the same line in two polygons. The edits and the checks keep them equal; that is the accepted
  cost of instant previews without a derivation.
- Checks stay in data, in the language they are written in. Sharing them with the Editor is left for later.
