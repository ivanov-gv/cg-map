# 0008: Corrected features carry no record of their correction

## Status

Accepted.

## Context

The editor plan asked corrected features to carry their own local origin, beside their upstream attribution. The ledger
in data/sources/editor-corrections.json already records each correction with its changeset, author, reason and values. A
property on each feature would be published: this repository is public, and the editor's source bundle on Pages holds
the source files byte for byte, because changesets are checked against their hashes. So stripping it at build time could
not keep it out of public data.

## Decision

- **No per-feature origin.** The importer writes features exactly as the reviewed changeset gives them, and adds
  nothing.
- **The ledger says what was corrected**, by revision-bound reference, with author, reason and both values.
- **A data release says when.** Each release has a version and a git tag, which is enough to tell which corrections it
  contains.

## Consequences

Published data and tiles stay free of editorial metadata. To learn whether one feature was corrected, read the ledger,
not the feature. The ledger's references are bound to one snapshot, so that lookup also stops at a re-extract.
