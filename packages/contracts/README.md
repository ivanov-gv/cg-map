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

`make verify PKG=packages/contracts` checks these files only. When a contract changes, CI also runs each producer's and
consumer's own pipeline.

`editor-bundle.schema.json` defines the version-1 source viewer bundle: one filename, byte size, feature count and
SHA-256 per source GeoJSON file. Data-owned assembly preserves bytes; the editor verifies the entire bundle before
enabling modes. Feature indices are tied to that hash and are not stable upstream identities. This contract does not
define editing or changesets; the formats below do. The bundle is built into dist/editor only.

`editor-layers.json` (shape in `editor-layers.schema.json`) lists what each source file allows: operations, geometry
types, editable properties and kinds, the level reserved for landmarks, placeholder values a property must not take, and
the source value of a new place. Anything unlisted is locked, which is what preserves unknown fields, attribution and
identity. `editor-changeset.schema.json` defines the export: base hash per changed file, and per operation a
revision-bound reference, a fingerprint and full before/after features. `fixtures/editor-geometry-cases.json` and
`fixtures/editor-property-cases.json` define the geometry and property rules; the editor and the importer both test
against them, and tests/integration/editor-changeset.test.mjs runs one's output through the other.
`editor-corrections.schema.json` defines the ledger the importer keeps of what it applied.

Building labels may also include separate `building_number`, building `lamela`, and `entrances` records. Each entrance
retains its OSM node ID, WGS84 coordinates, required inward `bearing`, optional `number`, Ulaz `ref`, `lamela`, and
`street`. Node IDs must be unique across buildings, appear in `address_sources`, and lie on the referenced footprint
boundary. Optional text is nonblank and at most 128 characters; no-number placeholders are rejected as numbers. There
are at most 100 entrances per building. A label needs a legacy house number, a separate building number, or a nonempty
entrance array. Legacy labels remain compatible; when entrances are supplied, consumers use `building_number` for a
separate building number and never promote the legacy aggregate into one. The shared
[fixture](fixtures/building-entrances.json) exercises producer and consumer together. See
[address display and source marking](../../docs/map-data/building-numbers.md).

Entrance `bearing` is clockwise degrees from north in `[0, 360)`. It is the inward normal of the nearest footprint wall
in the Mercator plane, including courtyard edges; ring winding does not change its meaning. The producer computes it and
validation rejects a direction more than 0.1 degrees from that normal. Consumers rotate the local arrow by
`bearing - 180` because its unrotated icon points south, align it with the map, and keep the arrow tip at the entrance.
The shared [orientation cases](fixtures/entrance-orientation-cases.json) are checked by the Python producer and Node
validator; browser tests verify the rotation binding and map/pitch alignment.

## Source entity identity

[entity-identity.schema.json](entity-identity.schema.json) defines source identity in `Feature.properties`, separately
from display IDs, attribution strings and snapshot indices. [source-entities.schema.json](source-entities.schema.json)
applies it to every feature in any of the eight source GeoJSON files. Existing geometry and domain contracts still
apply; these schemas add identity without replacing them.

A file adopts version 1 by adding `entitySchemaVersion: 1` to its FeatureCollection. All its features then require
`entityId` and `entityVersion`. `check-data` rejects partial adoption, unknown schema versions, or any of these reserved
identity fields in a file without the marker. Unannotated legacy files remain accepted until the deliberate migrations
in issues #66 and #32; this contract change does not annotate or refresh reviewed data. An empty adopted collection is
valid. The schema describes adopted files; legacy compatibility is a validator rollout rule.

| `entityId` prefix               | Meaning                                                                    | `entityVersion`                                         |
| ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `node/N`, `way/N`, `relation/N` | Typed OSM ID: positive decimal, no leading zeros                           | Positive OSM version, or a content hash until recovered |
| `ne:<code>`                     | Natural Earth country code                                                 | Content hash                                            |
| `epodgorica:<stopId>`           | Original stop ID under its source namespace                                | Content hash                                            |
| `derived:<name>`                | Named pipeline output, such as `derived:ocean`                             | Content hash                                            |
| `local:<uuid>`                  | New object with no upstream identity                                       | Content hash                                            |
| `cg-map-id:<uuid>`              | Once-assigned identity for legacy geometry with no reliable upstream match | Content hash                                            |

IDs are strings, including OSM numbers beyond JavaScript's safe integer range. UUIDs use lowercase, hyphenated RFC
variant form, versions 1–8; no nil UUIDs. Codes and stop IDs use ASCII letters, digits, underscores and hyphens; derived
names start with a lowercase letter and use lowercase letters, digits, underscores and hyphens. A version is either a
positive safe integer for OSM, or `sha256:` followed by 64 lowercase hexadecimal digits. Non-OSM objects cannot claim an
OSM version. A content version is an opaque base-revision token, encoded as `sha256:` and a lowercase digest. Its
assignment belongs to #66. Validation checks its form, not its derivation or the availability of the original base
bytes. Split parts share a token and editor edits retain the base token, so consumers must not try to recompute it from
a current feature.

Adopting a file whose editor rules allow `add` depends on #66: today version-1 additions cannot carry entity metadata,
and the importer rejects an added feature in an adopted collection. That migration must assign a `local:<uuid>` identity
and a base version when applying an addition before such files can be adopted.

An entity split or clipped into multiple features keeps its ID and version on each part and adds a nonnegative safe
integer `entityPart`, starting at zero. Within a file an ID occurs once without a part, or has distinct part numbers on
all occurrences with the same version. Part numbers need not be contiguous after clipping. A lone numbered part is
valid. `check-data` enforces these collection constraints, which JSON Schema cannot express. The same source entity may
have representations in different files, such as a footprint and an address label; identity does not imply identical
geometry across layers. Merging multiple upstream objects into one entity is forbidden; a genuinely computed object uses
its own `derived:` identity instead.

Identity metadata is preserved by consumer decoding, web normalization and editor edits/exports. It is locked by the
existing editor property rules. It neither replaces the current public place ID, stop ID or footprint-index join, nor
changes version-1 changeset references. Those migrations have their own issues. The shared
[fixture](fixtures/entity-identity-cases.json) covers accepted and rejected metadata and example collections for every
source file; data, web, editor and cross-component tests consume it together.
