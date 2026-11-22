# Shared contracts

Published formats shared by data producers and application consumers. Changes require producer and consumer review; see
[ownership](../../docs/system-architecture/ownership.md).

This folder is a published GitHub Package, `@ivanov-gv/map-contracts`. Its schemas, editor rules, fixtures, proto files
and `package.json` are exported; consumers import them by package path and pin an exact release such as `0.1.0`. The
repository version stays `0.0.0-dev` and is not an npm workspace, so it can never satisfy a pin. Merging a contract
change publishes a dev package; a [release](../../docs/runbooks/release.md#releasing-map-contracts) promotes it without
rebuilding. Data validation reads HEAD sources against HEAD contracts, and `tests/` reads HEAD through one helper by
default; a release run points that helper at the exact package being promoted.

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

`buildings.schema.json` defines OSM building footprints with copied `building`, `building:levels`, `building:material`,
`start_date`, `name`, `addr:street`, `addr:housenumber` and `roof:levels` tags. A house number that only says "no
number" is omitted and replaced by `nohousenumber: "yes"`; the placeholder list comes from the editor's
`addr:housenumber` rule. `addr:streetEntityId` is added only when case- and whitespace-folded `addr:street` matches
exactly one connected group of same-named published road ways (ways sharing an end node). It names the group's lowest
way ID, and `addr:streetEntityIds` lists every way in that group; an unmatched name or several disconnected groups has
no join field. Street folding never transliterates or removes punctuation. Its `addr:housenumber` placeholder rule is
identical to the building-label rule, and a data contract test keeps the two copies in step. There is no energy-class
property: no open OSM source supports one.

`building-entrances.schema.json` defines `building-entrances.geojson`: one adopted point feature per OSM `entrance=*`
node on or within one metre of a published footprint in the detail box. Its `entrance`, `ref`, `level`, `wheelchair`,
`door` and `addr:*` values are copied from the node; `buildingEntityId` points at the containing building's source
identity. The existing `entrances` array inside `building-labels.geojson` remains the runtime arrow/label format; this
file is the OSM-derived source and is read-only in the editor.

A place whose point lies inside a published building footprint also carries `buildingEntityId`, the footprint's source
identity. Overlaps resolve to the smallest containing footprint, then the lowest entity ID; a point outside every
footprint has no such field.

`proto/cgmap/transport/v1/transport.proto` defines the read-only ConnectRPC transport service and version-1 vehicle
messages. It adds a typed RPC interface without changing `vehicles.schema.json`. Direction message presence separates
unknown headings from a known northbound bearing of zero; check time is not GPS time and there is no stable vehicle ID.
The backend generates and commits its bindings; generated-client tests cover producer mapping, protobuf/JSON roundtrips,
stale/error semantics and compatibility with the shared GeoJSON snapshot. The browser continues using GeoJSON until an
explicit UI migration. See [backend generation and API usage](../../services/backend/README.md#protobuf-transport-api).

`make verify PKG=packages/contracts` checks these files only. When a contract changes, CI also runs each producer's and
consumer's own pipeline.

`editor-bundle.schema.json` defines the source viewer bundle: one filename, byte size, feature count and SHA-256 per
source GeoJSON file. Version 1 is frozen at the original eight files; version 2 adds `building-entrances.geojson` and
stays open until the Feature stack merges. Data-owned assembly writes version 2 and preserves bytes; the editor accepts
both versions and verifies the entire bundle before enabling modes. Feature indices are tied to that hash and are not
stable upstream identities. This contract does not define editing or changesets; the formats below do. The bundle is
built into dist/editor only. See [decision 0024](../../docs/decisions/0024-editor-bundle-versions.md).

`roads.geojson` carries OSM road attributes copied from the source: `bridge`, `tunnel`, `layer`, `oneway`, `access`,
`motor_vehicle`, `foot`, `bicycle`, `maxspeed`, `surface`, `lit`, `sac_scale`, `smoothness`, `parking:left`,
`parking:right`, `parking:both`, `parking:lane:left`, `parking:lane:right`, `parking:lane:both`, `junction`, `ref`, and
`name:en`. Walking routes get a computed `pathClass`. `main`: footway unless its surface is explicitly unpaved, and
paved pedestrian, cycleway, or path. `trail`: track, bridleway, any way with `sac_scale`, or path with an explicitly
unpaved surface. A path without surface and without `sac_scale` is unclassified; unknown surface is not treated as
unpaved. Detail-area roads record the OSM node ID and level at each real OSM end (`startNode`/`startLevel`,
`endNode`/`endLevel`): the `layer` tag as an integer, default 0; bridges without explicit layer get +1, tunnels get −1.
A part created by clipping keeps a node/level pair only when that end is the original OSM end node; a clip-boundary end
omits that pair.

`road-nodes.geojson` contains OSM nodes in the detail area with `highway=traffic_signals`, `crossing`, `stop`,
`give_way`, `mini_roundabout` or `turning_circle`. The editor cannot edit this file yet (`operations: []`).

`turn-restrictions.json` records `type=restriction` relations whose `from` and `to` ways are detail-area roads in
`roads.geojson`, with their OSM identity, `restriction` value, `from`/`to` way IDs and optional `via` nodes or ways.
Every `from`/`to`/`via` reference resolves in `roads.geojson` or `road-nodes.geojson`/road end nodes. It is not GeoJSON
because restrictions are topological relations, not geometries.

`editor-layers.json` (shape in `editor-layers.schema.json`) lists what each source file allows: operations, geometry
types, editable properties and kinds, the level reserved for landmarks, placeholder values a property must not take, and
the source value of a new place. Anything unlisted is locked, which is what preserves unknown fields, attribution and
identity. `editor-changeset.schema.json` defines the export: base hash per changed file, and per operation a
revision-bound reference, a fingerprint and full before/after features. `fixtures/editor-geometry-cases.json` and
`fixtures/editor-property-cases.json` define the geometry and property rules; the editor and the importer both test
against them, and tests/integration/editor-changeset.test.mjs runs one's output through the other.
`editor-corrections.schema.json` defines the ledger the importer keeps of what it applied. For land and water,
`properties.kind` repeats `editableKinds` as a required enum, so an edit can neither remove a published kind nor invent
one outside the reviewed source contract.

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

## Extracted land and water properties

`source-land-water.schema.json` defines the domain properties produced for `data/sources/land.geojson` and
`data/sources/water.geojson`. Identity remains under [source entities](#source-entity-identity); attribution and
geometry stay in the source collections. `kind` is required and is the published display kind, not a raw OSM tag.

`landKind` covers `country` and preserved Natural Earth `context` outlines, plus extracted `park`, `garden`, `woods`,
`meadow`, `grass`, `scrub`, `sports`, `cemetery` and `playground` areas. `waterKind` covers the derived `ocean`, lake,
river, reservoir, pond, basin and generic `water` areas, the `stream`, `canal`, `ditch` and `drain` lines, and separate
`coastline` lines. Coastlines are features in `water.geojson`, not a ninth source file; the ocean polygon is still
`derived:ocean` and is computed from the reviewed land outline and the OSM coastline.

`osmTag` is the exact lower-case OSM `key=value` that determined the kind; the first rule in the producer's priority
list wins when an object carries several candidate tags. It is required on extracted features and absent only on
preserved outlines and the derived ocean. `name` and `name:en` are verbatim OSM names, copied only when mapped and
nonblank; absent or blank OSM tags produce no property. `destination: true` is additive and appears only when a
documented green-area destination rule matches; it is never `false`. `tunnel` and `intermittent` carry verbatim OSM tag
values on waterway lines and are absent when unmapped.

`check-data` rejects unsupported kinds, malformed new properties, and clockwise exteriors or counterclockwise holes in
extracted land-cover and water polygons. Preserved country and context outlines keep their source winding. Multipolygon
holes remain part of the geometry; ring order is structural validation, not a GIS topology guarantee. Consumers keep
accepting the older `park`, `water` and `river` values.

## Source entity identity

[entity-identity.schema.json](entity-identity.schema.json) defines source identity in `Feature.properties`, separately
from display IDs, attribution strings and snapshot indices. [source-entities.schema.json](source-entities.schema.json)
applies it to every feature in any of the nine source GeoJSON files. Existing geometry and domain contracts still apply;
these schemas add identity without replacing them.

A file adopts version 1 by adding `entitySchemaVersion: 1` to its FeatureCollection. All its features then require
`entityId` and `entityVersion`. `check-data` rejects partial adoption, unknown schema versions, or any of these reserved
identity fields in a file without the marker. All nine reviewed source collections have adopted version 1. An empty
adopted collection is valid. The schema describes adopted files; legacy compatibility remains only for fixtures and
explicitly unannotated test data.

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
OSM version. A content version is an opaque base-revision token, encoded as `sha256:` and a lowercase digest. The
extractor derives it from the preserved static source; the importer derives it from an added feature's reviewed export
bytes. Validation checks its form, not its derivation or the availability of the original base bytes. Split parts share
a token and editor edits retain the base token, so consumers must not try to recompute it from a current feature.

A file whose editor rules allow `add` can adopt version 1: the data-owned importer assigns a fresh `local:<uuid>`
identity and a `sha256:` content version to each addition when it writes an adopted collection. An added feature must
not claim those fields itself. The version hashes the reviewed export as submitted, before the importer adds identity;
later edits keep the assigned base token until a new import replaces the object.

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
