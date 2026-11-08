# Task: Entity IDs and data releases

Status: planned. Agreed with the owner on 2026-11-08, after #23.

## Goal and acceptance criteria

Every map object has an entity ID. Several people or agents fix data in parallel, their fixes merge by that ID into one
release, and the release is tagged and published. Where an object comes from OpenStreetMap, the ID is OSM's own, so our
data stays comparable with OSM and edits can travel both ways.

- **Same ID as OSM.** An object from OSM carries its typed OSM ID, `node/N`, `way/N` or `relation/N`, and the OSM
  version it was read at. The same building on openstreetmap.org has the same ID.
- **One ID scheme for everything else.** Objects from other sources carry that source's ID under its own prefix:
  `ne:<code>` for Natural Earth countries, `epodgorica:<stopId>` for bus stops, `derived:<name>` for what the pipeline
  computes, such as the ocean. A new object made by an editor is `local:<uuid>` until it exists upstream.
- **Merge by ID.** A changeset says "object X, based on version N, changes these fields". Any number of changesets merge
  automatically; only the same field changed in two different ways is a conflict, reported for a person to decide.
  Changesets no longer break when the data is refreshed: an object still at its version applies, one changed upstream is
  reported.
- **Releases.** Merging, validation and the tile rebuild produce a release, which is committed and tagged
  `data/vYYYY.MM.N`. A CD pipeline attaches the release to a GitHub release as a versioned download.
- **Rich in the repository, light for users.** data/ keeps everything needed to compare with and write back to OSM: ID,
  version, all tags, and the node IDs of each outline. The editor reads all of it. Public builds strip what users do not
  need, so apps and tiles get no heavier.
- **Back to OSM**, last: an export of our changes as an OSM change file against current OSM, tags first, then geometry.

Affected: data (extraction, sources, importer, releases), packages/contracts (schemas, changeset version 2), apps/editor
(references by ID, merge-friendly export), apps/web and the tile build (stripping), .github (release pipeline).

## Decisions

Defaults chosen with the owner's agreement; record the lasting ones in the decisions log as each PR lands.

- **A fresh extract, not a recovery.** Re-extract from current OSM with an extractor that keeps IDs, versions, tags and
  node IDs. The alternative, recovering IDs for today's snapshot from the dated October extract, keeps the reviewed
  geometry but needs that exact file, which may no longer be downloadable, and Geofabrik's public files may lack
  versions. No correction has been applied yet, so a refresh loses nothing.
- **Same coverage and detail** as today: detailed central Podgorica, major roads and attractions countrywide.
- **Display geometry stays simplified**, as today, for size. The node IDs and full-precision coordinates needed for
  writing geometry back live beside it in data/, not in public files.
- **Changesets live in the repository**, as files under data/changesets/, arriving by PR. A release merges all pending
  ones and records which it contains.
- **Date-based release versions**, `data/vYYYY.MM.N`, like the existing tag-driven releases of map-core and the browser
  image.
- **One feature per OSM object.** An object the pipeline splits or clips keeps its ID on every part, with a part number.
  An object it merges is not allowed: merging would lose identity.

## Progress

- Completed: places already carry OSM IDs (1,526 `node/`, 285 `way/`), and address labels carry recovered way IDs.
- Remaining, one PR each, in order:
  1. **ID contract.** Schemas for the ID, version and prefixes on every source file; validation in check-data; the
     consumer tests in web and editor. No data change yet.
  2. **Fresh extract.** Extend data/tools/extract-osm.py to keep IDs, versions, tags and node IDs; re-extract; rebuild
     labels and tiles; review counts and provenance. A deliberate data refresh, reviewed as one.
  3. **Strip for users.** The web build and tile build drop what users do not need; a test proves the public artifact
     holds only listed properties, and sizes are compared with today's.
  4. **Changeset version 2.** References by entity ID and base version instead of file index and snapshot hash. The
     editor exports it, the importer applies it, and version 1 changesets stay readable until none remain.
  5. **Merge tool.** Merges every changeset under data/changesets/, applies the result, and reports conflicts by object
     and field, with tests for parallel edits to the same and different objects.
  6. **Release pipeline.** Tag, release notes from the merged changesets, and a CD workflow publishing sources, tiles
     and provenance as release assets, in test-run mode first as `.github/TESTING.md` requires.
  7. **Export to OSM.** An OSM change file of our tag edits against current OSM, refusing objects whose OSM version
     moved; then geometry, through the stored node IDs. Uploading follows OSM's import and automated edits guidelines, a
     manual step this plan does not automate.
- Unblocked by step 2: addresses on unnumbered footprints, building metadata, and carrying corrections across snapshots,
  from [the editor plan](internal-layer-editor.md).
- Blockers: none.

## Verification

Each PR records its own. Step 2 must show, for a sample of objects, the same ID and version as on openstreetmap.org.

## Handoff

Nothing implemented yet. Start with step 1. The rebuild preview from the editor plan is independent and goes first.
