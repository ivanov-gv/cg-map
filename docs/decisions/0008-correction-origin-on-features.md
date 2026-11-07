# 0008: Corrected features name their changeset

## Status

Accepted.

## Context

The ledger in data/sources/editor-corrections.json told a local correction from an imported upstream fact, but a feature
alone gave no sign of having been corrected. The editor plan requires corrections to keep their base attribution and
also carry a local origin.

## Decision

- **One property.** The importer sets `correction_changeset` on every feature a changeset adds or modifies, to that
  changeset's ID. A later correction replaces it. Author, reason and values stay in the ledger.
- **Only the importer sets it.** A changeset that tries to is refused, and the data check requires each value to be in
  the ledger.
- **It is not a fact.** `places_facts_sha256` leaves it out.
- **It is not an identity.** It says who last changed a feature, not which feature this is, so it does not help with
  refreshing or rebasing corrections.
- **It is published.** Nothing strips it, so it appears in places.geojson, building-labels.geojson and, after a rebuild,
  in vector tile tags.

## Consequences

A changeset ID becomes public, which is harmless for the editor's UUIDs, but a hand-written ID must not hold private
text. Tiles grow by one tag per corrected feature. Stripping it at build time would keep public output smaller, at the
price of public data that no longer shows what was corrected locally.
