# Task: Entity IDs and data releases

Issue: #30. The issue and its sub-issues hold scope, status and dependencies; this plan holds their history.

## Context

Corrections today name an object by its position in one source snapshot, so they cannot survive a data refresh, and most
editor layers cannot add or delete objects. Several people or agents also need to fix data in parallel and publish the
result as tagged releases. Stable entity IDs, the same as OpenStreetMap's where an object comes from OSM, solve both.
Affected: data, packages/contracts, apps/editor, apps/web and the tile build, and .github.

## Decisions

Defaults chosen with the owner's agreement; record the lasting ones in the decisions log as each PR lands.

- **A fresh extract, not a recovery.** Re-extract from current OSM with an extractor that keeps IDs, versions, tags and
  node IDs. The alternative, recovering IDs for today's snapshot from the dated October extract, keeps the reviewed
  geometry but needs that exact file, which may no longer be downloadable, and Geofabrik's public files may lack
  versions. No correction has been applied yet, so a refresh loses nothing.
- **Same coverage and detail** as today: detailed central Podgorica, major roads and attractions countrywide.
- **Display geometry stays simplified**, as today, for size. The node IDs and full-precision coordinates needed for
  writing geometry back live beside it in data/, not in public files.
- **Git is the merge tool.** No changeset store and no merge tool: a fix is a PR to the dataset. That needs source files
  written one feature per line in ID order, so that git merges by object, and no derived file in a fixing PR, because
  hashes and counts would make every pair of PRs conflict. Derived files are regenerated at release.
- **Date-based release versions**, `data/vYYYY.MM.N`, like the existing tag-driven releases of map-core and the browser
  image.
- **One feature per OSM object.** An object the pipeline splits or clips keeps its ID on every part, with a part number.
  An object it merges is not allowed: merging would lose identity.

## History

- 2026-11-08: moved the goal, acceptance criteria, status and the seven steps into #30 and its sub-issues, under the new
  rule that an issue is the source of truth and a plan its history. The steps, previously one ordered list, became
  "blocked by" links that record only real dependencies: the contract (#31) blocks the fresh extract (#32), which blocks
  stripping (#33), mergeable sources (#34) and changeset version 2 (#35). Version 2 also waits for mergeable sources,
  because the importer applies it as a commit for a PR. The release pipeline (#36) needs stripping and mergeable
  sources, and export to OSM (#37) needs version 2 references. The old list put export to OSM last; that was a
  preference, not a dependency, so it was dropped.
- 2026-11-08: plan agreed with the owner, after #23, as a fresh extract rather than a recovery of IDs for the October
  snapshot. (#27)
