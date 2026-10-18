# Shared contracts

Published formats shared by data producers and application consumers. Changes require producer and consumer review; see [ownership](../../docs/ownership.md).

`places.schema.json` defines the published place feature: a stable nonempty string identity, nonempty name, supported category, and WGS84 longitude/latitude point. The data validator enforces this contract and directory-wide uniqueness. Integration tests check that web categories agree with it.

Version breaking changes deliberately. This package is a contract boundary, not a place for miscellaneous shared implementation helpers.
