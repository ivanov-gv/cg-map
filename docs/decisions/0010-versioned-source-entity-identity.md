# 0010: Versioned source entity identity

## Status

Accepted.

## Context

Issue #31 establishes source identity before a data migration. Today's snapshots have display IDs and revision-bound
indices, but legacy geometry has no reliable upstream identity. Issue #66 needs temporary identities and content
versions before issue #32 recovers OSM identities and versions. Consumers must retain the metadata while those later
changes migrate references and joins.

## Decision

Use the [source entity contract](../../packages/contracts/README.md#source-entity-identity): `entityId`, `entityVersion`
and optional `entityPart` in feature properties. Keep those fields separate from renderer IDs and existing domain IDs.
The ID namespace names the upstream source, a derived output, a new local object, or once-assigned legacy geometry. OSM
versions are positive integers; content hashes provide a base version when no upstream version is available.

Adopt the contract with `entitySchemaVersion: 1` on a whole source collection. Reject incomplete or unversioned identity
metadata, while retaining unannotated legacy files during the separately reviewed migrations. Validate identity in the
data producer and test unchanged metadata through both consumers. A split entity keeps its identity and source version
on each numbered part; independent layer representations may share a source identity.

## Consequences

This PR can establish and test the contract without rewriting sources, inventing OSM claims, or rebuilding geography.
The migrations must explicitly opt in each file and assign its identities and base versions. Existing place IDs, stop
IDs, footprint joins and version-1 changesets continue to use their current formats until their own migrations.

Source identity and its base version are not a record of corrections. The correction ledger remains authoritative, as
[decision 0008](0008-no-correction-origin-on-features.md) requires. Public property stripping remains separate work.
