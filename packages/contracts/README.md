# Shared contracts

Published formats shared by data producers and application consumers. Changes require producer and consumer review; see [ownership](../../docs/ownership.md).

`places.schema.json` defines the published place feature: a stable nonempty string identity, nonempty name, supported category, and WGS84 longitude/latitude point. The data validator enforces this contract and directory-wide uniqueness. Integration tests check that web categories agree with it.

Version breaking changes deliberately. This package is a contract boundary, not a place for miscellaneous shared implementation helpers.

`stops.schema.json` defines static stop snapshot features. Preserve upstream stopId as feature id; IDs must be unique within the collection. Names are nonblank, coordinates are WGS84 longitude/latitude within Montenegro. data/tools/check-data.mjs enforces these rules and provenance integrity; browser acceptance verifies selection and offline rendering.

`transit-network.schema.json` describes the published version-1 representative bus network: source date, a stop-ID dictionary (names and WGS84 coordinates), and forward ordered stop IDs with equally sized monotonic relative seconds per pattern. The producer validates referenced stops, coordinates, bounds and provenance. It contains no service calendar or claimed departure predictions. Consumers must label suggestions and waiting-time limits; see [routing](../../docs/routing.md).
