# Shared contracts

Published formats shared by data producers and application consumers. Changes require producer and consumer review; see
[ownership](../../docs/system-architecture/ownership.md).

This folder is a published GitHub Package, `@ivanov-gv/map-contracts`. Its schemas, editor rules, fixtures, proto files
and `package.json` are exported; consumers import them by package path and pin an exact release such as `0.1.0`. The
repository version stays `0.0.0-dev` and is not an npm workspace, so it can never satisfy a pin. Merging a contract
change publishes a dev package; a [release](../../docs/runbooks/release.md#releasing-map-contracts) promotes it without
rebuilding. Data validation reads HEAD sources against HEAD contracts, and `tests/` reads HEAD through one helper by
default; a release run points that helper at the exact package being promoted.

At released versions, `places.schema.json` defines the published place feature: a stable nonempty string identity,
nonempty name, supported category, WGS84 longitude/latitude point, and a visibility level. Optional facts include `kind`
(OSM tag value), `standalone` (true when not inside a building), `name:en`, `name:sr-Latn`, `phone` (normalised from
`contact:phone`), `website` (normalised from `contact:website`), `email` (normalised from `contact:email`),
`opening_hours` (OSM format), `wheelchair`, `addr:street`, `addr:housenumber`, `level`, `cuisine`, `wikidata`,
`wikipedia`. The data validator enforces this contract and directory-wide uniqueness. Integration tests check that web
categories agree with it. See [ADR 0027](../../docs/decisions/0027-place-categories-and-standalone-points.md) for which
OSM kinds are extracted and which are excluded as category gaps.

At released versions, `place-visibility.json` (shape in `place-visibility.schema.json`) is the one level-to-zoom table.
Level 1 appears earliest; levels are consecutive and zooms strictly increase, so eligibility is cumulative. The producer
requires a valid `visibilityLevel` on every published place. A consumer may read a missing value as
`legacyFallbackLevel`, but must reject a present invalid value rather than treat it as high priority. The web build
copies this file into its offline shell. Neither side keeps its own copy of the thresholds. Version 5 keeps the per-kind
defaults as a display rule and stores only a POI's `visibilityOverride`.

Breaking changes follow [decision 0039](../../docs/decisions/0039-strong-foundation-before-v1.md). This package is a
contract boundary, not a place for miscellaneous shared implementation helpers.

At released versions, `stops.schema.json` defines static stop snapshot features. Preserve upstream stopId as feature id;
IDs must be unique within the collection. Names are nonblank, coordinates are WGS84 longitude/latitude within
Montenegro. Each stop may carry optional `lines` (sorted route numbers serving the stop), `side` (`left` or `right` of
the nearest road), and `name:en` (only where a source publishes it). data/tools/check-data.mjs enforces these rules and
provenance integrity; browser acceptance verifies selection and offline rendering. Version 5 drops `lines` and `side`.

At released versions, `transit-routes.schema.json` defines the published bus route network: version, retrieval time,
source, and an array of routes. Each route has an optional number and optional name, a network type (`bus` for city
lines, `intercity` for OSM intercity routes), optional colour (hex format), and ordered directions with stop IDs. City
routes use ePodgorica stop IDs; intercity routes use OSM node IDs (`node/N`). Each OSM direction records
`fromMunicipality` and `toMunicipality` (ISO3166-2 codes like `ME-16`) so the consumer can see which Montenegrin
municipality each end serves. The producer validates that city route stops exist in the stops file and that stop `lines`
match the routes. Intercity routes carry OSM relation identity and version.

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

At released versions, `buildings.schema.json` defines OSM building footprints with copied `building`, `building:levels`,
`building:material`, `start_date`, `name`, `addr:street`, `addr:housenumber` and `roof:levels` tags. A house number that
only says "no number" is omitted and replaced by `nohousenumber: "yes"`; the placeholder list comes from the editor's
`addr:housenumber` rule. `addr:streetEntityId` is added only when case- and whitespace-folded `addr:street` matches
exactly one connected group of same-named published road ways (ways sharing an end node). It names the group's lowest
way ID, and `addr:streetEntityIds` lists every way in that group; an unmatched name or several disconnected groups has
no join field. Street folding never transliterates or removes punctuation. Its `addr:housenumber` placeholder rule is
identical to the building-label rule, and a data contract test keeps the two copies in step. There is no energy-class
property: no open OSM source supports one. Version 5 keeps the street link but drops the name-derived join, moves labels
onto the building and business POIs onto the object itself.

At released versions, `building-entrances.schema.json` defines `building-entrances.geojson`: one adopted point feature
per OSM `entrance=*` node on or within one metre of a published footprint in the detail box. Its `entrance`, `ref`,
`level`, `wheelchair`, `door` and `addr:*` values are copied from the node; `buildingEntityId` points at the containing
building's source identity. The existing `entrances` array inside `building-labels.geojson` remains the runtime
arrow/label format; this file is the OSM-derived source; an entrance added in the editor has a `local:` identity.

At released versions, a place whose point lies inside a published building footprint also carries `buildingEntityId`,
the footprint's source identity. Overlaps resolve to the smallest containing footprint, then the lowest entity ID; a
point outside every footprint has no such field. Version 5 makes it an owner-set link with an existence check only.

`proto/cgmap/transport/v1/transport.proto` defines the read-only ConnectRPC transport service and version-1 vehicle
messages. It adds a typed RPC interface without changing `vehicles.schema.json`. Direction message presence separates
unknown headings from a known northbound bearing of zero; check time is not GPS time and there is no stable vehicle ID.
The backend generates and commits its bindings; generated-client tests cover producer mapping, protobuf/JSON roundtrips,
stale/error semantics and compatibility with the shared GeoJSON snapshot. The browser continues using GeoJSON until an
explicit UI migration. See [backend generation and API usage](../../services/backend/README.md#protobuf-transport-api).

`make verify PKG=packages/contracts` checks these files only. When a contract changes, CI also runs each producer's and
consumer's own pipeline.

At released versions, `roads.geojson` carries OSM road attributes copied from the source: `bridge`, `tunnel`, `layer`,
`oneway`, `access`, `motor_vehicle`, `foot`, `bicycle`, `maxspeed`, `surface`, `lit`, `sac_scale`, `smoothness`,
`parking:left`, `parking:right`, `parking:both`, `parking:lane:left`, `parking:lane:right`, `parking:lane:both`,
`junction`, `ref`, and `name:en`. Walking routes get a computed `pathClass`. `main`: footway unless its surface is
explicitly unpaved, and paved pedestrian, cycleway, or path. `trail`: track, bridleway, any way with `sac_scale`, or
path with an explicitly unpaved surface. A path without surface and without `sac_scale` is unclassified; unknown surface
is not treated as unpaved. Roads are a graph: two roads join where they share a point on the same level. Each real OSM
end records its junction and level (`startNode`/`startLevel`, `endNode`/`endLevel`); roads that end at one junction end
at one place. The level of an end is that of its junction: the level of a road that passes through it, otherwise the one
nearest to the ground of the roads that end there. Along a road its level is the `layer` tag as an integer, default 0; a
bridge without it is +1 and a tunnel −1. A part created by clipping keeps the pair only at its original OSM ends. A
junction that came from the editor has a `local:` ID. Version 5 stores streets, junctions and turn rules as objects in
this file instead of deriving end levels or keeping a separate restrictions file.

At released versions, `road-nodes.geojson` contains OSM nodes with `highway=traffic_signals`, `crossing`, `stop`,
`give_way`, `mini_roundabout` or `turning_circle`, in the detail area and on published roads beyond it. Nodes added in
the editor have a `local:` identity.

At released versions, `turn-restrictions.json` records `type=restriction` relations between published roads, with their
OSM identity, `restriction` value, `from`/`to` roads and optional `via` junctions or roads. A road or junction is named
by its OSM number, or by its `local:` ID when it came from the editor. Every reference resolves in `roads.geojson` or
`road-nodes.geojson`. It is not GeoJSON because restrictions are topological relations, not geometries.

At released versions, `settlement-areas.geojson` holds the area of a settlement where one is mapped;
`settlementEntityId` names the settlement, which has at most one area. Version 5 merges the two files.

`editor-bundle.schema.json` defines the editor's source bundle: one filename, byte size, feature count and SHA-256 per
source file. Version 1 holds the original eight files, version 2 thirteen, version 3 every file of an object on the map,
including `transit-routes.json` and `turn-restrictions.json`, whose records count as features without geometry, and
version 4 adds `bridges.geojson` and `railways.geojson` but leaves out derived `slopes.geojson`, so it declares 23
source files. Version 5 declares the agreed data model in eleven files: `surface.geojson`, `roads.geojson`,
`buildings.geojson`, `places.geojson`, `settlements.geojson`, `relief.geojson`, `canyon-rims.geojson`,
`transport-stops.geojson`, `bridges.geojson`, `railways.geojson` and `transit-routes.json`. Versions 1–4 are released
and frozen; the producer and the Editor keep writing and reading version 3 here. Version 5 is a pending declaration, not
an emitted bundle: the Editor first pins this release and reads version 5, then data seeds the new files once from
today's data and emits it. Data-owned assembly preserves bytes, and the Editor verifies every listed file. It is built
into dist/editor only. See [decision 0024](../../docs/decisions/0024-editor-bundle-versions.md),
[decision 0037](../../docs/decisions/0037-every-layer-editable.md),
[ADR 0048](../../docs/decisions/0048-ridges-are-drawn-slopes-derived.md) and ADR 0049.

The released `0.2.0` package added version 4: bridge outlines, railway tracks, platforms and stations, and owner-drawn
ridges. Its `bridges.geojson` rule allows Polygon add, modify and delete; `name` and `name:en` are editable text, while
`kind`, `method`, `osmTag` and `sourceRoadIds` keep only the values the reviewed source uses. The seed provenance from
[ADR 0047](../../docs/decisions/0047-bridge-outlines-seeded-once.md) is not re-derived or invented: `method` is `osm` or
`traced`, an OSM outline carries `man_made=bridge`, and a traced outline names sorted source road IDs. The
`railways.geojson` rule allows Point, LineString and Polygon add, modify and delete, matching the geometries the
reviewed source stores. `name`, `gauge` and `ref` are editable text; `kind` and `osmTag` keep only the values the source
uses, and `osmTag` is add-only provenance. The `ridges.geojson` rule allows LineString add, modify and delete. `kind` is
`ridge`, and `summit` and `summitName` stay optional together when a summit is linked. That version has no
`sunlitSide`/`shadedSide`: all 31 ridges stored the same `south` and `north` text, and the sun's direction belongs to
the derivation, not to each stored line. Those rules remain in the shared file while versions 3 and 4 remain readable.

## Pending version 5: the agreed data model

This change is the next `@ivanov-gv/map-contracts` release, but no package is published here and no consumer pin
changes. The model is the owner's 2026-11-27 decision in ADR 0049 and issues
[#514](https://github.com/ivanov-gv/cg-map/issues/514) to [#518](https://github.com/ivanov-gv/cg-map/issues/518).

An object is stored as it is shown, with one `entityId` and no copy of it in `osm_id`, `id` or `footprintIndex`. No
source stores a derived value: new structures are seeded once from today's map, and a value the sources do not have
stays absent. The build publishes stored features into tile layers, cut and simplified per zoom, and copies stored or
linked values; it computes no new value. Style rules read only a feature's own properties, such as a contour every 100 m
drawn bold, a POI's icon from its kind, a settlement's size from `place` and `population`, and a road from its type,
`layer`, `bridge` and `tunnel`. OSM's shape is converted only at its boundary: the import groups and links what OSM
splits, and the export writes OSM's form back. Shared edges are the one stored fact repeated in two polygons; same-file
edits move both, and a check keeps them equal.

### Files and their within-file checks

`editor-layers.json` cannot require a property for one kind or limit one kind's geometry. Where that matters, the table
names the rule that the data step adds to `check-data`; its importer runs `check-data` on every changeset. Every file
also keeps the [source-identity rules](#source-entity-identity): one identity per object, unique in its file unless
split into parts.

| File                      | Holds                                                                                                                                                                                                                                       | Checks inside that file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface.geojson`         | Municipalities with `labelPoint`, neighbour countries, the stored sea polygon, land cover, shades, protected areas, water areas and waterway lines. `kind` lists every stored kind; `limitedKinds` only lets the frame's kinds be modified. | Municipalities, neighbours and the sea tile the frame with no gaps or overlaps; shared edges are equal; a shade is a MultiPolygon inside one green area, at most one per area, optional; a water area links its river line with `riverEntityId`; waterway lines are valid and `intermittent`/`tunnel` are typed; a lake carrying a POI has its `iconPoint` inside; green and protected areas keep a stored, movable `labelLine`, and municipalities and unassigned water keep a stored `labelPoint`. The country outline, duplicate neighbour countries, coastline lines, `edges`, `neighbouringMunicipalities`, border `left`/`right` and `derived:ocean` are gone. |
| `roads.geojson`           | Road ways with stored `pathClass`, no-geometry `street` objects with one stored name, `junction` Points only where a level, crossing or signal is stated, and `restriction` Points at their junction.                                       | A junction Point lies on a road point; joins are exact; roads meeting at one junction share its `level`; no feature means ground. A restriction's `from`, `to` and `via*` resolve to road or junction objects in this file. A road split copies its `streetEntityId` to both parts; the street name is stored once. `inGreenArea`, `startLevel`, `endLevel` and `turn-restrictions.json` are gone.                                                                                                                                                                                                                                                                   |
| `bridges.geojson`         | Polygon deck outlines; `sourceRoadIds` is provenance, not a link.                                                                                                                                                                           | Decks are valid and do not overlap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `railways.geojson`        | Tracks, platforms and stations.                                                                                                                                                                                                             | `kind` fits the geometry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `buildings.geojson`       | Building Polygons with addresses, `labelPoint`/`labelBearing`, business tags and `iconPoint` when the building is the POI, and entrance Points with `buildingEntityId`.                                                                     | An entrance lies on its building's outline and names a building in this file; label and icon points lie inside the building. An address links its street with `addr:streetEntityId`. `osm_id`, `footprintIndex`, `building-labels.geojson`, `building-entrances.geojson` and the street-name copy are gone.                                                                                                                                                                                                                                                                                                                                                          |
| `places.geojson`          | Stand-alone POIs and POIs inside another object, with the owner-set `buildingEntityId` link and an optional `visibilityOverride`.                                                                                                           | Typed tags are valid; a POI's shown level is its override or the kind's default in the policy table. A POI that is a building, summit or lake lives on that object with its tags and `iconPoint`, so one card opens for both outline and icon. `id`, `category`, the per-POI `visibilityLevel` copy and the street-name copy are gone.                                                                                                                                                                                                                                                                                                                               |
| `settlements.geojson`     | Settlement points and settlement areas.                                                                                                                                                                                                     | Each area names one settlement in this file with `settlementEntityId`, and a settlement has at most one area. `rank`, `municipality` and `settlement-areas.geojson` are gone; rank is a style rule on `place` and `population`.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `relief.geojson`          | Contours with `elevation`, and summits with `ele`, name and POI tags with `iconPoint` when a summit is the viewpoint.                                                                                                                       | Contours never cross, and a summit is higher than the contours around it. `index`, `demElevation`, every height-check field, `contours.geojson` and `summits.geojson` are gone; a summit without an OSM height shows none.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `canyon-rims.geojson`     | Rims with owner-painted `height` and `width`, their `bank`, and a `riverEntityId` link.                                                                                                                                                     | Height is 0–2600 m and width is 0–2000 m; `lengthMetres` and the river's text name are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `transport-stops.geojson` | Stops with a unique `stopId` and name.                                                                                                                                                                                                      | `stopId` is unique in the file; `lines` and `side` are gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `transit-routes.json`     | Routes with ordered directions naming stop IDs.                                                                                                                                                                                             | Route shape and direction order are valid; every named stop exists (see the cross-file checks below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The field pattern for a link is `node/N`, `way/N`, `relation/N` or `local:<uuid>`; `reference` in `editor-layers.json`
names the file that holds the target. `position` is a WGS84 longitude/latitude pair and `positions` is a line of them.
The shared rules are not versioned: they keep released-only properties while the producer still emits version 3,
including places' `category`, `visibilityLevel` and `addr:street`, settlement `rank` and `municipality`, roads'
`startLevel`, `endLevel` and `pathClass: main`, and stops' `lines` and `side`. Version 5 replaces them with the values
and links above; its file set gives the old split files no place. The Editor's version-5 step stops showing those files
and edits the merged ones.

### Links across files

Following a link is the only computation allowed across files, and data adds only these existence checks:

- `streetEntityId` links, including `addr:streetEntityId` on buildings, entrances and POI features, name a `street`
  object that exists in `roads.geojson`;
- `buildingEntityId` on a place names a building that exists in `buildings.geojson`; on an entrance the target is in the
  same file, checked by the rule above;
- `riverEntityId` on a canyon rim names a river object that exists in `surface.geojson`; on a surface water area the
  target is in the same file;
- every stop ID named by a `transit-routes.json` direction exists in `transport-stops.geojson`.

`settlementEntityId` on a settlement area and `greenAreaEntityId` on a shade are checked inside their own file; they are
not cross-file rules. A cross-file check confirms only that the target exists. It never checks geometry, point-in-
polygon membership or a copied value. The build and the Editor may follow a link to copy a displayed value, such as a
street name onto its roads or a river name onto an area card, but neither stores that copy as a source fact.

`editor-layers.json` (shape in `editor-layers.schema.json`) lists what each bundled file allows: operations, geometry
types, properties with their types and limits, kinds, the level reserved for landmarks, placeholder values and the
source value of a new place. Anything unlisted is locked, which preserves unknown fields, attribution and identity.
`limitedKinds` narrows kinds that are derived or only frame the map; `derivedGeometry` marks shapes the editor computes
from another edit; `addOnly` values become identity once written; a label's located `entrances` may only move with their
building. `editor-changeset.schema.json` defines the export. Version 2 names an existing object by `entityId` (and
`entityPart`) with a fingerprint and full before/after features; a new object keeps its `local:` ID as its entity ID.
`featureIndex`, bound to one snapshot, remains for routes and for version 1. `fieldItems` carry rough work from the
field, which the importer never writes. Canyon rims accept add, change and delete: a new rim may state optional
whole-metre `height` and `width`. The build measures height; the owner paints width. Width is the horizontal distance
seen from above, from the rim to the slope foot, in whole metres, and no edge has one until then. An omitted width means
`0 m`, a vertical edge. The height range is a contract limit because a sampled value outside it is a bad build, not a
missing measurement. Width runs from `0` to `2000` m because zero is a real edge and a local canyon is far below two
kilometres wide; a larger typed value is a units or typing mistake
([ADR 0044](../../docs/decisions/0044-owner-painted-canyon-width.md)). `method` is not editable. At released versions
`river` is text and `bank` is locked; version 5 replaces the text with the `riverEntityId` link above and states `bank`.
The importer assigns its `local:` ID, `canyon-rim` kind and `editor-drawn` method, and refuses a changeset that states
those derived facts. At released versions it also assigns `lengthMetres`, computes label positions, street joins,
measures, summit checks, contour direction and provenance, so a changeset never carries them; an added label states
`buildingEntityId` instead of `footprintIndex`. In version 5 those values are stored facts or link copies as described
above. `fixtures/editor-geometry-cases.json` and `fixtures/editor-property-cases.json` define the geometry and property
rules; the editor and the importer both test against them, and tests/integration/editor-changeset.test.mjs runs one's
output through the other. `editor-corrections.schema.json` defines the ledger of what was applied, replayed over a fresh
extract. For files with editable kinds, `properties.kind` repeats `editableKinds`, so an edit can neither remove a
published kind nor invent one; in version 5, `surface.geojson` and `relief.geojson` repeat every editable kind plus each
kind narrowed through `limitedKinds`, and that union is the whole enum.

At released versions, `relief.schema.json` describes the published contour, summit, slope, ridge and canyon-rim
properties. Features carry object facts only: no per-feature `source`, green-kind list, minimum area, ridge radius or
other build parameter. Those values live in the `relief` block of `data/sources/provenance.json`, together with layer
sources, and the full build report stays in temporary `.build/relief-report.json`. The data validator checks the
recorded green kinds against this contract's land-kind enum and the discovered kinds against `land.geojson`. Contours,
ridges and canyon-rim features are `LineString` features; slopes are derived `Polygon` faces cut from green areas by the
stored ridges. A ridge is one stored `LineString` fact, seeded once from the DEM on 2026-11-27 and not rebuilt by later
runs; it lies inside one green area and its ends meet that area's outline or another ridge. A green area without ridges
stays one flat colour. A summit link and name stay with a ridge only when a summit is within 50 m of the line. Derived
ridge/slope/contour/DEM-rim IDs are deterministic for pinned inputs but are not stable across a DEM or green-area
change. Summit `heightCheck` is `missing`, `mismatch` or `ok`: a mismatch needs a closed contour above OSM height around
the summit or an OSM/DEM difference over 25 m, and a missing OSM height keeps its DEM fact without a mismatch. Canyon
rims publish OSM `natural=cliff` segments as `method: "osm-cliff"` features with their OSM `way/N` identity and version;
DEM-derived bank segments use `derived:canyon-rim-<river>-<bank>` with `entityPart` and `method: "dem-canyon-bank"`; a
rim added in the editor has `method: "editor-drawn"` and no `river` or `bank`. A rim may publish one optional integer
`height`; how the build measures it belongs to the data runbook. Its owner-painted `width` belongs to
[ADR 0044](../../docs/decisions/0044-owner-painted-canyon-width.md). Every canyon rim keeps the low side on its right;
an edge without a river is not compared with a centreline
([ADR 0042](../../docs/decisions/0042-one-measured-canyon-rim-height.md)). Every contour runs with higher ground on its
left. Feature length is a fact; build parameters live in provenance. Consumers must keep DEM elevations, height checks
and rim methods separate from OSM facts. It is a structural contract, not a GIS topology proof. Version 5 replaces the
ridge and slope derivation with stored shades in `surface.geojson`, merges contours and summits into `relief.geojson`,
and drops every height-check field as the [pending model](#pending-version-5-the-agreed-data-model) states.

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

At released versions, `source-land-water.schema.json` defines the domain properties produced for
`data/sources/land.geojson` and `data/sources/water.geojson`. Identity remains under
[source entities](#source-entity-identity); attribution and geometry stay in the source collections. `kind` is required
and is the published display kind, not a raw OSM tag.

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
accepting the older `park`, `water` and `river` values. Version 5 merges these areas and lines into `surface.geojson`;
the stored sea, shades, label lines and shared-edge checks are in the
[pending model](#pending-version-5-the-agreed-data-model).

The shared [municipality-area cases](fixtures/municipality-area-cases.json) pin the two kinds in
`municipalities.geojson`: an OSM `municipality` with `ISO3166-2`, and a derived `unassigned-water` area with sorted
`neighbouringMunicipalities`, a `labelPoint`, ordered `edges` and no ISO code. Both adopt source entity identity; water
uses a content-version `entityVersion`. `data/tools/check-data.mjs` and `data/tests/data-validation.test.mjs` validate
both fixtures, and the Python topology check rebuilds their polygons from the same ordered edges.

## Source entity identity

[entity-identity.schema.json](entity-identity.schema.json) defines source identity in `Feature.properties`, separately
from display IDs, attribution strings and snapshot indices. [source-entities.schema.json](source-entities.schema.json)
applies it to every feature in each reviewed source GeoJSON file. Existing geometry and domain contracts still apply;
these schemas add identity without replacing them.

A file adopts version 1 by adding `entitySchemaVersion: 1` to its FeatureCollection. All its features then require
`entityId` and `entityVersion`. `check-data` rejects partial adoption, unknown schema versions, or any of these reserved
identity fields in a file without the marker. Reviewed source collections that carry `entitySchemaVersion: 1` adopt this
identity; an empty adopted collection is valid. The schema describes adopted files; legacy compatibility remains only
for fixtures and explicitly unannotated test data.

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
