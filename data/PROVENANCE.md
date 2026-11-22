# Source provenance

`sources/provenance.json` inventories the actual editable layers shipped in this export.
`sources/provenance-legacy.json` preserves the predecessor's metadata; its raster-runtime fields are historical and do
not describe the current application.

The reviewed OSM extract timestamp is 2026-11-20T21:21:21Z. Display geometry remains simplified and rounded, but detail
now covers the whole city within `[19.15, 42.37, 19.34, 42.51]`, alongside countrywide major roads, water, attractions
and the country outline. There are 43,978 buildings, 21,247 road features, 332 land features and 1,491 water features
including one derived ocean polygon. The place snapshot has 1,876 entries. No source file exceeds 40 MB; the reviewed
archive is 20,985,409 bytes.

The current version-2 reviewed source bundle has nine GeoJSON files; the frozen version-1 bundle has the original eight
without `building-entrances.geojson`. `sources/building-entrances.geojson` is a read-only OSM extract of 157 tagged
entrance nodes on or within one metre of a published footprint, with 28 nearby candidates left unjoined. The refreshed
`sources/buildings.geojson` carries 43,978 `building` values, 445 `building:levels`, three `building:material`, one
`start_date`, 265 `name`, 142 `roof:levels`, 896 `addr:street` and 1,003 `addr:housenumber` values. Six no-number
placeholders were omitted and recorded as `nohousenumber: "yes"`. A street name joins to a road entity only when case-
and whitespace-folded text matches exactly one connected group of same-named road ways; `addr:streetEntityId` names the
group's lowest way ID and `addr:streetEntityIds` lists its members: 321 joined and 575 did not. The reviewed
`places.geojson` stays with the branch below, so no published place carries a `buildingEntityId` join and
`building_details` has no place-join counts. The extractor still writes them when a `places` group is refreshed with
`buildings`. Counts per copied tag and entrance kind live in `sources/provenance.json` under `building_details`. No
energy-class field is published: no open OSM source in this extract supports one, and marking that gap here avoids
presenting an inferred value as a source fact.

`sources/editor-corrections.json` appears once a reviewed changeset has been applied. Shaped by
`packages/contracts/editor-corrections.schema.json`, it records each local correction with its author, reason and full
before and after values. It is what tells a local correction from an imported upstream fact: an edited feature keeps its
upstream attribution, so read the ledger to see what changed locally. Its references are bound to one snapshot and do
not survive a re-extract, which replaces the source files.

`visibilityLevel` on each place is editorial product metadata from `sources/place-visibility-policy.json`, not an OSM
fact or a measure of significance. `places_facts_sha256` in `sources/provenance.json` covers the snapshot without that
field and still equals the hash of the pre-level snapshot. See the
[data runbook](../docs/runbooks/data.md#place-visibility-levels).

`sources/context-countries.geojson` preserves the supplied Natural Earth public-domain surrounding-country features
independently of extraction. Its features carry `ne:<code>` identities and content-hash versions; the OSM and Natural
Earth licenses remain separate.

The input PBF is not included in Git: it is an external downloadable dataset, not application source. Basemap rebuilding
from the included GeoJSON needs no PBF. This release used the 34,780,415-byte
`https://download.geofabrik.de/europe/montenegro/montenegro-latest.osm.pbf` downloaded 2026-11-21, with SHA-256
`70de54274bad52be8452852995f34280b5cbf37f2bbb207dcf56cb90410a3a5b`; the URL serves changing data. Retain the exact
snapshot outside the repository when a reproducible refresh matters.

`data/tools/extract-osm.py` is now a thin entry point to `data/tools/osm_extract/`, with one module per layer group so
later Features can add their own. A fresh complete extract, label rebuild and archive rebuild were run from the reviewed
PBF. Full runs give preserved Natural Earth and ePodgorica snapshots their own identity namespaces; `--layers` replaces
only the named source files. OSM features keep the object's type, ID and upstream version; clipped or split parts keep
one identity and gain `entityPart`. See [decision 0022](../docs/decisions/0022-extract-source-identity.md) for the
constraints behind this design. It is not a full OSM semantic/cartographic pipeline; see
[architecture](../docs/system-architecture/architecture.md) before expanding coverage.

## Bus stops

`data/sources/transport-stops.geojson` contains 719 ePodgorica stops retrieved 2026-10-18 from the public stops/all
endpoint. Source IDs and coordinates are retained; only the published stopId, stopName (as name), longitude and latitude
are kept. Its independent provenance JSON records the endpoint, retrieval time, hash and count. It is a static snapshot,
separate from the OSM layers and live vehicles. No explicit reuse license was found; attribution is retained without
assigning MIT or ODbL to this source.

## Transit route patterns

transit-network.json and transit-network.provenance.json are a separately dated public ePodgorica import. They contain
stop coordinates and representative ordered route patterns with relative running times, sampled by
direction/headsign/stop count from weekday, Saturday, and Sunday trips. They are not an exhaustive timetable or service
calendar. Refresh with data/tools/import-transit.py; raw API responses are temporary and excluded from Git. Source URLs,
sampling limits, counts, hash, and license status are recorded.

## Building address labels

`building-labels.geojson` recovers published OSM house numbers for the refreshed footprints from the same reviewed
2026-11-20 extract. Its independent provenance file binds 1,207 labels to the new buildings.geojson hash and records
1,003 direct building addresses, 204 node-derived addresses and 43,923 matched footprints. Each label keeps the matched
footprint way ID and OSM way version as its source identity; real way IDs are recovered by exact rounded footprint
matching, and point addresses are joined only through unambiguous node membership or containment. No-number placeholders
and ambiguous joins are excluded. The runtime label layer is bundled for offline use. See
[building numbers](../docs/map-data/building-numbers.md).
