# Shared contracts

Published formats shared by data producers and application consumers. Changes require producer and consumer review; see
[ownership](../../docs/system-architecture/ownership.md).

`places.schema.json` defines the published place feature: a stable nonempty string identity, nonempty name, supported
category, WGS84 longitude/latitude point, and a visibility level. The data validator enforces this contract and
directory-wide uniqueness. Integration tests check that web categories agree with it.

`place-visibility.json` (shape in `place-visibility.schema.json`) is the one level-to-zoom table. Level 1 appears
earliest; levels are consecutive and zooms strictly increase, so eligibility is cumulative. The producer requires a
valid `visibilityLevel` on every published place. A consumer may read a missing value as `legacyFallbackLevel`, but must
reject a present invalid value rather than treat it as high priority. The web build copies this file into its offline
shell. Neither side keeps its own copy of the thresholds.

Version breaking changes deliberately. This package is a contract boundary, not a place for miscellaneous shared
implementation helpers.

`stops.schema.json` defines static stop snapshot features. Preserve upstream stopId as feature id; IDs must be unique
within the collection. Names are nonblank, coordinates are WGS84 longitude/latitude within Montenegro.
data/tools/check-data.mjs enforces these rules and provenance integrity; browser acceptance verifies selection and
offline rendering.

`transit-network.schema.json` describes the published version-1 representative bus network: source date, a stop-ID
dictionary (names and WGS84 coordinates), and forward ordered stop IDs with equally sized monotonic relative seconds per
pattern. The producer validates referenced stops, coordinates, bounds and provenance. It contains no service calendar or
claimed departure predictions. Consumers must label suggestions and waiting-time limits; see
[routing](../../docs/ui-ux/features/routing.md).

`vehicles.schema.json` defines the live vehicle feed: route and position per vehicle, the check time, stale flag and
source. The upstream has no vehicle IDs, GPS times or heading. `bearing` (degrees from north) with `heading: "movement"`
is optional: the Go server adds it once a vehicle has moved between its checks; services/transit-relay does not.
Consumers validate both fields together and must not present a missing bearing as known.
fixtures/vehicle-direction-cases.json defines the movement rules; the Go producer and the browser tracker both test
against it.

`building-labels.schema.json` defines a house-number label anchored inside a reviewed building polygon. Actual OSM way
IDs identify footprints; footprintIndex is a revision-bound array reference tied to the buildings SHA-256, never a
stable identity. The current tile producer generates building feature IDs from the same footprint indices; archive
acceptance verifies ID and location correspondence for every numbered footprint. Consumers join polygon clicks by this
revision-bound index rather than visible label hits. Address source IDs are retained. The producer validates containment
(excluding holes), uniqueness, nonblank numbers, no-number placeholders, and source/provenance integrity. Labels do not
imply complete address coverage.

`proto/cgmap/transport/v1/transport.proto` defines the read-only ConnectRPC transport service and version-1 vehicle
messages. It adds a typed RPC interface without changing `vehicles.schema.json`. Direction message presence separates
unknown headings from a known northbound bearing of zero; check time is not GPS time and there is no stable vehicle ID.
The backend generates and commits its bindings; generated-client tests cover producer mapping, protobuf/JSON roundtrips,
stale/error semantics and compatibility with the shared GeoJSON snapshot. The browser continues using GeoJSON until an
explicit UI migration. See [backend generation and API usage](../../services/backend/README.md#protobuf-transport-api).
