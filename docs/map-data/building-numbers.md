# Building and entrance addresses

House-number labels appear inside existing building footprints when the bottom-left metric scale reaches 100 m, and
remain enabled at closer scales. The cutoff uses the same ground distance across 100 screen pixels as the scale control,
following latitude and camera changes. Labels use local fonts and normal collision avoidance, so closely spaced numbers
may be suppressed until zooming in further. Clicking anywhere on a numbered building offers its address and From/To
actions, even when its number is hidden by label collisions or the scale cutoff. Labels are included in the saved
offline map.

The legacy geometry export dropped address tags. data/tools/build-building-labels.py recovers them from the exact
reviewed Geofabrik PBF (SHA-256 checked before processing). It matches existing rounded footprint rings to OSM building
ways, recovers real way IDs, and prefers a direct building addr:housenumber. If absent, it uses address nodes only when
uniquely associated by original node membership or polygon containment. It does not choose the nearest building or
interpolate house numbers. Locally used bb/bez broja placeholders mean no number and are excluded. Buildings with no
recorded number remain blank. Invalid or ambiguous geometry/associations are skipped.

The label anchor is an interior point with high edge clearance. Original footprint geometry and the PMTiles basemap stay
unchanged; the separately published GeoJSON label layer adds the recovered metadata without rebuilding geography.
Selection joins the polygon’s generated vector-tile ID to the revision-bound footprintIndex in the address snapshot.
Archive integration tests verify all numbered footprints have the correct ID and location before release; these indices
are not stable identities across source revisions. Polygon hits take precedence over label hit boxes. Node-derived
addresses retain their original source IDs. The provenance file records source PBF hash, footprint hash, record counts,
method and label file hash. The root validator checks every label lies inside its referenced polygon and outside holes.
Address metadata is OSM/ODbL data, not inferred or Google-derived.

To reproduce, install data/tools/requirements.txt, then run
`python data/tools/build-building-labels.py /path/to/reviewed/montenegro.osm.pbf`. A different source PBF requires
explicit provenance review and an updated hash gate. Run make check and browser acceptance. Fresh full extraction also
now retains OSM building identity, name, and address tags rather than discarding them. This feature does not promise
unrecorded numbers or building coverage outside the existing detailed area.

## Entrances and separate building numbers

The building-label contract also accepts an optional `building_number`, a building `lamela`, and an `entrances` array.
Each entrance has its original OSM node `id`, WGS84 `coordinates`, and inward wall-normal `bearing`; optional `number`,
`ref` (Ulaz), `lamela`, and `street` fields keep those identifiers distinct. An unnumbered door still has a location.
The shared [fixture](../../packages/contracts/fixtures/building-entrances.json) demonstrates the format.

With entrances present, `addr:housenumber` remains legacy compatibility metadata and is not treated as a separate
building number. Use `building_number` only when the building itself has a recorded number. One numbered entrance with
no building number displays `Ulica Slobode 27`. Multiple numeric entrance numbers display their naturally ordered
bounds, for example `Ulica Slobode 27-32`; the range summarizes recorded numbers and does not claim every intervening
entrance exists. A separate building number displays `Ulica Slobode, Zgrada 1, 27-32`. Lettered numbers are listed
without inventing a numeric interval. Different street addresses stay separate. Unknown numbers stay blank.

Entrance points and individual labels appear at zoom 18 and closer. Selecting a building brings its recorded entrances
into the uncovered map area and shows small arrows perpendicular to the nearest walls, pointing from outside toward the
entrance positions, with individual labels even below zoom 18. Closing or changing the selection clears those arrows.
Selecting an entrance offers its exact position as a route endpoint. Ulaz and Lamela identifiers are shown in the
entrance label and the building's entrance list. A directory place inside that building also reveals its entrances
through the existing footprint selection.

## Marking entrances in the source

This PoC remains read-only: marking means adding reviewed entrance records to the source GeoJSON, not drawing or saving
edits in the browser. For an existing label, add `entrances` to its properties, retain the recovered way identity and
revision-bound footprint index, and include each entrance node ID in `address_sources`. For a building without a label,
recover its real source way identity and add an interior label anchor before recording its entrances; do not fabricate
identities from legacy geometry. Record real entrance coordinates on the footprint boundary, including courtyard
boundaries. The required `bearing` is clockwise degrees from north in `[0, 360)`, perpendicular to the nearest wall and
pointing into the building. The producer computes it in the map's Mercator plane; validation checks its direction within
0.1 degrees, including reversed rings and courtyard walls. The arrow rotates and pitches with the map, retaining its
wall alignment. The validator allows the existing six-decimal coordinate precision at edges. Update the label
provenance's hash, bytes, counts and method after reviewing the source facts, then run `make verify PKG=data`,
`make check`, and `make test-e2e`. Changes to footprint geometry still require the geography rebuild described in the
data runbook.

A deliberate run of `build-building-labels.py` now preserves explicitly tagged OSM entrance nodes, their house numbers
and `ref` separately from a way's building number. It retains only unambiguous footprint associations. Address nodes
without an entrance tag keep their legacy address meaning; their locations are never promoted into doors. Such an
upstream extraction replaces local source annotations, so retain/review them separately before importing again. No
source data was refreshed for this capability: the existing reviewed snapshot has no explicit entrance records and
therefore gains no guessed arrows. Entrance data travels in the existing local/offline label asset, without an API or
changes to the reviewed archive.
