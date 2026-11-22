# 0031: Transit routes file and municipality classification

## Status

Accepted.

## Context

Feature #330 adds published transit routes for city and OSM bus lines. The repository needs a deterministic, reviewable
source file for those routes, and a rule for deciding whether an OSM bus route is `bus` or `intercity` without manual
curation.

## Decision

`data/sources/transit-routes.json` is the reviewed source of published routes. City routes come from the ePodgorica
transit network and are grouped by direction from `sampleTrip` (`_AB_`/`_BA_`), with variants kept inside the same
direction. Each OSM bus relation becomes one direction carrying `entityId` (`relation/N`) and `entityVersion`. OSM
directions are grouped only by route_master membership; a relation without a route_master is its own line.

OSM route classification uses reviewed municipality boundaries with `ISO3166-2` starting `ME-`. A direction is
`intercity` when its first and last stops are in different municipalities or either end is outside Montenegro; otherwise
it is `bus`. Each direction records `fromMunicipality` and `toMunicipality` when known.

Transit route provenance records sources separately: ePodgorica retains its retrieval time and license status; OSM bus
relations and municipality boundaries are attributed to OpenStreetMap contributors under ODbL 1.0. The PBF is recorded
by file name, SHA-256 and replication timestamp, not a local path. `retrievedAt` is deterministic from input provenance.
